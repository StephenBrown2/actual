// @ts-strict-ignore
import * as d from 'date-fns';
import deepEqual from 'deep-equal';
import JSON5 from 'json5';
import { v4 as uuidv4 } from 'uuid';

import { captureBreadcrumb } from '../../platform/exceptions';
import * as connection from '../../platform/server/connection';
import { logger } from '../../platform/server/log';
import { currentDay, dayFromDate, parseDate } from '../../shared/months';
import { q } from '../../shared/query';
import {
  extractScheduleConds,
  getDateWithSkippedWeekend,
  getHasTransactionsQuery,
  getNextDate,
  getScheduledAmount,
  getStatus,
  recurConfigToRSchedule,
} from '../../shared/schedules';
import type { ScheduleEntity } from '../../types/models';
import { addTransactions } from '../accounts/sync';
import { createApp } from '../app';
import { aqlQuery } from '../aql';
import * as db from '../db';
import { toDateRepr } from '../models';
import { mutator, runMutator } from '../mutators';
import * as prefs from '../prefs';
import { Rule } from '../rules';
import { addSyncListener, batchMessages } from '../sync';
import {
  getRules,
  insertRule,
  ruleModel,
  updateRule,
} from '../transactions/transaction-rules';
import { undoable } from '../undo';
import { RSchedule } from '../util/rschedule';

import { findSchedules } from './find-schedules';

// Utilities

function zip(arr1, arr2) {
  const result = [];
  for (let i = 0; i < arr1.length; i++) {
    result.push([arr1[i], arr2[i]]);
  }
  return result;
}

const SCHEDULE_TRANSFER_VERSION = 1;

type RuleLike = {
  stage?: 'pre' | 'post' | null;
  conditionsOp?: 'and' | 'or';
  conditions: unknown[];
  actions: unknown[];
};

type ScheduleTransferItem = {
  name?: string | null;
  posts_transaction?: boolean;
  completed?: boolean;
  rule: RuleLike;
};

type ScheduleTransferPayload = {
  version: number;
  exportedAt: string;
  schedules: ScheduleTransferItem[];
};

export type ScheduleImportError = {
  scheduleName: string | null;
  message: string;
};

export type ScheduleImportResult = {
  imported: number;
  skipped: number;
  errors: ScheduleImportError[];
};

function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

function getCanonicalRuleField(field: string): string {
  if (field === 'acct') {
    return 'account';
  }
  if (field === 'description') {
    return 'payee';
  }
  return field;
}

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

type NameLookup = {
  idsByName: Map<string, string>;
  ambiguousNames: Set<string>;
};

type CategoryLookup = NameLookup & {
  idsByNameAndGroup: Map<string, string>;
};

function buildNameLookup(
  items: Array<{ id: string; name: string }>,
): NameLookup {
  const idsByName = new Map<string, string>();
  const ambiguousNames = new Set<string>();

  for (const item of items) {
    const normalized = normalizeName(item.name);
    if (!normalized) {
      continue;
    }

    if (idsByName.has(normalized)) {
      ambiguousNames.add(normalized);
      idsByName.delete(normalized);
      continue;
    }

    if (!ambiguousNames.has(normalized)) {
      idsByName.set(normalized, item.id);
    }
  }

  return { idsByName, ambiguousNames };
}

function buildCategoryLookup(
  items: Array<{ id: string; name: string; groupName: string | null }>,
): CategoryLookup {
  const { idsByName, ambiguousNames } = buildNameLookup(items);
  const idsByNameAndGroup = new Map<string, string>();

  for (const item of items) {
    const normalizedName = normalizeName(item.name);
    const normalizedGroup = normalizeName(item.groupName);
    if (!normalizedName || !normalizedGroup) {
      continue;
    }

    idsByNameAndGroup.set(`${normalizedName}\u0000${normalizedGroup}`, item.id);
  }

  return { idsByName, ambiguousNames, idsByNameAndGroup };
}

function mapIdValuesToNames(
  value: unknown,
  namesById: Map<string, string>,
): unknown {
  if (typeof value === 'string') {
    return namesById.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      typeof item === 'string' ? (namesById.get(item) ?? item) : item,
    );
  }
  return value;
}

function mapNameValuesToIds({
  value,
  idsByName,
  ambiguousNames,
  entityLabel,
}: {
  value: unknown;
  idsByName: Map<string, string>;
  ambiguousNames: Set<string>;
  entityLabel: string;
}): unknown {
  const mapSingle = (name: string) => {
    const normalized = normalizeName(name);
    if (!normalized) {
      return name;
    }
    if (ambiguousNames.has(normalized)) {
      throw new Error(`${entityLabel} name is ambiguous: ${name}`);
    }
    const id = idsByName.get(normalized);
    if (!id) {
      throw new Error(`${entityLabel} not found: ${name}`);
    }
    return id;
  };

  if (typeof value === 'string') {
    return mapSingle(value);
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      typeof item === 'string' ? mapSingle(item) : item,
    );
  }
  return value;
}

function mapCategoryNameToId({
  value,
  groupName,
  categoryLookup,
}: {
  value: string;
  groupName: string | null;
  categoryLookup: CategoryLookup;
}): string {
  const normalizedName = normalizeName(value);
  if (!normalizedName) {
    return value;
  }

  if (groupName) {
    const normalizedGroup = normalizeName(groupName);
    if (normalizedGroup) {
      const scopedId = categoryLookup.idsByNameAndGroup.get(
        `${normalizedName}\u0000${normalizedGroup}`,
      );
      if (scopedId) {
        return scopedId;
      }
      if (categoryLookup.ambiguousNames.has(normalizedName)) {
        throw new Error(
          `Category not found with group: ${value} (${groupName})`,
        );
      }
    }
  }

  if (categoryLookup.ambiguousNames.has(normalizedName)) {
    throw new Error(`Category name is ambiguous: ${value}`);
  }

  const id = categoryLookup.idsByName.get(normalizedName);
  if (!id) {
    throw new Error(`Category not found: ${value}`);
  }
  return id;
}

function mapRuleEntriesForExport(
  entries: unknown[],
  {
    accountNamesById,
    payeeNamesById,
    categoryNamesById,
    categoryGroupNamesById,
  }: {
    accountNamesById: Map<string, string>;
    payeeNamesById: Map<string, string>;
    categoryNamesById: Map<string, string>;
    categoryGroupNamesById: Map<string, string>;
  },
): unknown[] {
  return entries.map(entry => {
    if (!isObject(entry) || typeof entry.field !== 'string') {
      return entry;
    }

    const canonicalField = getCanonicalRuleField(entry.field);
    const normalizedEntry =
      canonicalField === entry.field
        ? entry
        : { ...entry, field: canonicalField };

    if (canonicalField === 'account') {
      return {
        ...normalizedEntry,
        value: mapIdValuesToNames(normalizedEntry.value, accountNamesById),
      };
    }
    if (canonicalField === 'payee') {
      return {
        ...normalizedEntry,
        value: mapIdValuesToNames(normalizedEntry.value, payeeNamesById),
      };
    }
    if (canonicalField === 'category') {
      if (typeof normalizedEntry.value === 'string') {
        return {
          ...normalizedEntry,
          value: mapIdValuesToNames(normalizedEntry.value, categoryNamesById),
          ...(categoryGroupNamesById.get(normalizedEntry.value)
            ? {
                category_group: categoryGroupNamesById.get(
                  normalizedEntry.value,
                ),
              }
            : {}),
        };
      }
      if (Array.isArray(normalizedEntry.value)) {
        const categoryGroups = normalizedEntry.value.map(value =>
          typeof value === 'string'
            ? (categoryGroupNamesById.get(value) ?? null)
            : null,
        );
        return {
          ...normalizedEntry,
          value: mapIdValuesToNames(normalizedEntry.value, categoryNamesById),
          ...(categoryGroups.some(groupName => groupName != null)
            ? { category_groups: categoryGroups }
            : {}),
        };
      }
      return {
        ...normalizedEntry,
        value: mapIdValuesToNames(normalizedEntry.value, categoryNamesById),
      };
    }

    return normalizedEntry;
  });
}

async function mapRuleEntriesForImport(
  entries: unknown[],
  {
    accountIdsByName,
    accountAmbiguousNames,
    payeeIdsByName,
    payeeAmbiguousNames,
    categoryLookup,
  }: {
    accountIdsByName: Map<string, string>;
    accountAmbiguousNames: Set<string>;
    payeeIdsByName: Map<string, string>;
    payeeAmbiguousNames: Set<string>;
    categoryLookup: CategoryLookup;
  },
): Promise<unknown[]> {
  const mappedEntries = [];
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.field !== 'string') {
      mappedEntries.push(entry);
      continue;
    }

    const canonicalField = getCanonicalRuleField(entry.field);
    const normalizedEntry =
      canonicalField === entry.field
        ? entry
        : { ...entry, field: canonicalField };

    if (canonicalField === 'account') {
      mappedEntries.push({
        ...normalizedEntry,
        value: mapNameValuesToIds({
          value: normalizedEntry.value,
          idsByName: accountIdsByName,
          ambiguousNames: accountAmbiguousNames,
          entityLabel: 'Account',
        }),
      });
      continue;
    }

    if (canonicalField === 'payee') {
      if (typeof normalizedEntry.value === 'string') {
        const normalized = normalizeName(normalizedEntry.value);
        if (!normalized) {
          mappedEntries.push(normalizedEntry);
          continue;
        }
        if (payeeAmbiguousNames.has(normalized)) {
          throw new Error(`Payee name is ambiguous: ${normalizedEntry.value}`);
        }
        let payeeId = payeeIdsByName.get(normalized);
        if (!payeeId) {
          payeeId = await db.insertPayee({ name: normalizedEntry.value });
          payeeIdsByName.set(normalized, payeeId);
        }
        mappedEntries.push({ ...normalizedEntry, value: payeeId });
      } else if (Array.isArray(normalizedEntry.value)) {
        const mappedValues = [];
        for (const value of normalizedEntry.value) {
          if (typeof value !== 'string') {
            mappedValues.push(value);
            continue;
          }
          const normalized = normalizeName(value);
          if (!normalized) {
            mappedValues.push(value);
            continue;
          }
          if (payeeAmbiguousNames.has(normalized)) {
            throw new Error(`Payee name is ambiguous: ${value}`);
          }
          let payeeId = payeeIdsByName.get(normalized);
          if (!payeeId) {
            payeeId = await db.insertPayee({ name: value });
            payeeIdsByName.set(normalized, payeeId);
          }
          mappedValues.push(payeeId);
        }
        mappedEntries.push({ ...normalizedEntry, value: mappedValues });
      } else {
        mappedEntries.push(normalizedEntry);
      }
      continue;
    }

    if (canonicalField === 'category') {
      const {
        category_group: categoryGroup,
        category_groups: categoryGroups,
        ...entryWithoutCategoryMeta
      } = normalizedEntry as typeof normalizedEntry & {
        category_group?: unknown;
        category_groups?: unknown;
      };

      if (typeof entryWithoutCategoryMeta.value === 'string') {
        mappedEntries.push({
          ...entryWithoutCategoryMeta,
          value: mapCategoryNameToId({
            value: entryWithoutCategoryMeta.value,
            groupName: typeof categoryGroup === 'string' ? categoryGroup : null,
            categoryLookup,
          }),
        });
        continue;
      }

      if (Array.isArray(entryWithoutCategoryMeta.value)) {
        const mappedValues = entryWithoutCategoryMeta.value.map(
          (value, idx) => {
            if (typeof value !== 'string') {
              return value;
            }
            const groupName =
              Array.isArray(categoryGroups) &&
              typeof categoryGroups[idx] === 'string'
                ? categoryGroups[idx]
                : null;
            return mapCategoryNameToId({ value, groupName, categoryLookup });
          },
        );
        mappedEntries.push({
          ...entryWithoutCategoryMeta,
          value: mappedValues,
        });
        continue;
      }

      mappedEntries.push({
        ...entryWithoutCategoryMeta,
        value: entryWithoutCategoryMeta.value,
      });
      continue;
    }

    mappedEntries.push(normalizedEntry);
  }

  return mappedEntries;
}

function parseScheduleTransfer(raw: string): ScheduleTransferPayload {
  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch {
    throw new Error('Unable to parse schedules file as JSON5');
  }

  if (!isObject(parsed)) {
    throw new Error('Schedules file must be an object');
  }
  if (parsed.version !== SCHEDULE_TRANSFER_VERSION) {
    throw new Error(
      `Unsupported schedules file version: ${String(parsed.version ?? 'missing')}`,
    );
  }
  if (!Array.isArray(parsed.schedules)) {
    throw new Error('Schedules file must contain a schedules array');
  }

  return parsed as ScheduleTransferPayload;
}

export function updateConditions(conditions, newConditions) {
  const scheduleConds = extractScheduleConds(conditions);
  const newScheduleConds = extractScheduleConds(newConditions);

  const replacements = zip(
    Object.values(scheduleConds),
    Object.values(newScheduleConds),
  );

  const updated = conditions.map(cond => {
    const r = replacements.find(r => cond === r[0]);
    return r && r[1] ? r[1] : cond;
  });

  const added = replacements
    .filter(x => x[0] == null && x[1] != null)
    .map(x => x[1]);

  return updated.concat(added);
}

export async function getRuleForSchedule(id: string | null): Promise<Rule> {
  if (id == null) {
    throw new Error('Schedule not attached to a rule');
  }

  const { data: ruleId } = await aqlQuery(
    q('schedules').filter({ id }).calculate('rule'),
  );
  return getRules().find(rule => rule.id === ruleId);
}

async function fixRuleForSchedule(id) {
  const { data: ruleId } = await aqlQuery(
    q('schedules').filter({ id }).calculate('rule'),
  );

  if (ruleId) {
    // Take the bad rule out of the system so it never causes problems
    // in the future
    await db.delete_('rules', ruleId);
  }

  const newId = await insertRule({
    stage: null,
    conditionsOp: 'and',
    conditions: [
      { op: 'isapprox', field: 'date', value: currentDay() },
      { op: 'isapprox', field: 'amount', value: 0 },
    ],
    actions: [{ op: 'link-schedule', value: id }],
  });

  await db.updateWithSchema('schedules', { id, rule: newId });

  return getRules().find(rule => rule.id === newId);
}

export async function setNextDate({
  id,
  start,
  conditions,
  reset,
}: {
  id: string;
  start?;
  conditions?;
  reset?: boolean;
}) {
  if (conditions == null) {
    const rule = await getRuleForSchedule(id);
    if (rule == null) {
      throw new Error('No rule found for schedule');
    }
    conditions = rule.serialize().conditions;
  }

  const { date: dateCond } = extractScheduleConds(conditions);

  const { data: nextDate } = await aqlQuery(
    q('schedules').filter({ id }).calculate('next_date'),
  );

  // Only do this if a date condition exists
  if (dateCond) {
    const newNextDate = getNextDate(
      dateCond,
      start ? start(nextDate) : new Date(),
    );

    if (newNextDate !== nextDate) {
      // Our `update` functon requires the id of the item and we don't
      // have it, so we need to query it
      const nd = await db.first<
        Pick<db.DbScheduleNextDate, 'id' | 'base_next_date_ts'>
      >(
        'SELECT id, base_next_date_ts FROM schedules_next_date WHERE schedule_id = ?',
        [id],
      );

      await db.update(
        'schedules_next_date',
        reset
          ? {
              id: nd.id,
              base_next_date: toDateRepr(newNextDate),
              base_next_date_ts: Date.now(),
            }
          : {
              id: nd.id,
              local_next_date: toDateRepr(newNextDate),
              local_next_date_ts: nd.base_next_date_ts,
            },
      );
    }
  }
}

// Methods

async function checkIfScheduleExists(name, scheduleId) {
  const idForName = await db.first<Pick<db.DbSchedule, 'id'>>(
    'SELECT id from schedules WHERE tombstone = 0 AND name = ?',
    [name],
  );

  if (idForName == null) {
    return false;
  }
  if (scheduleId) {
    return idForName['id'] !== scheduleId;
  }
  return true;
}

export async function createSchedule({
  schedule = null,
  conditions = [],
} = {}): Promise<ScheduleEntity['id']> {
  const scheduleId = schedule?.id || uuidv4();

  const { date: dateCond } = extractScheduleConds(conditions);
  if (dateCond == null) {
    throw new Error('A date condition is required to create a schedule');
  }
  if (dateCond.value == null) {
    throw new Error('Date is required');
  }

  const nextDate = getNextDate(dateCond);
  const nextDateRepr = nextDate ? toDateRepr(nextDate) : null;
  if (schedule) {
    if (schedule.name) {
      if (await checkIfScheduleExists(schedule.name, scheduleId)) {
        throw new Error('Cannot create schedules with the same name');
      }
    } else {
      schedule.name = null;
    }
  }

  // Create the rule here based on the info
  const ruleId = await insertRule({
    stage: null,
    conditionsOp: 'and',
    conditions,
    actions: [{ op: 'link-schedule', value: scheduleId }],
  });

  const now = Date.now();
  await db.insertWithUUID('schedules_next_date', {
    schedule_id: scheduleId,
    local_next_date: nextDateRepr,
    local_next_date_ts: now,
    base_next_date: nextDateRepr,
    base_next_date_ts: now,
  });

  await db.insertWithSchema('schedules', {
    ...schedule,
    id: scheduleId,
    rule: ruleId,
  });

  return scheduleId;
}

// TODO: don't allow deleting rules that link schedules

export async function updateSchedule({
  schedule,
  conditions,
  resetNextDate,
}: {
  schedule;
  conditions?;
  resetNextDate?: boolean;
}) {
  if (schedule.rule) {
    throw new Error('You cannot change the rule of a schedule');
  }
  let rule;

  // This must be outside the `batchMessages` call because we change
  // and then read data
  if (conditions) {
    const { date: dateCond } = extractScheduleConds(conditions);
    if (dateCond && dateCond.value == null) {
      throw new Error('Date is required');
    }

    // We need to get the full rule to merge in the updated
    // conditions
    rule = await getRuleForSchedule(schedule.id);

    if (rule == null) {
      // In the edge case that a rule gets corrupted (either by a bug in
      // the system or user messing with their data), don't crash. We
      // generate a new rule because schedules have to have a rule
      // attached to them.
      rule = await fixRuleForSchedule(schedule.id);
    }
  }

  await batchMessages(async () => {
    if (conditions) {
      const oldConditions = rule.serialize().conditions;
      const newConditions = updateConditions(oldConditions, conditions);

      await updateRule({ id: rule.id, conditions: newConditions });

      // Annoyingly, sometimes it has `type` and sometimes it doesn't
      const stripType = ({ type: _type, ...fields }) => fields;

      // Update `next_date` if the user forced it, or if the account
      // or date changed. We check account because we don't update
      // schedules automatically for closed account, and the user
      // might switch accounts from a closed one
      if (
        resetNextDate ||
        !deepEqual(
          oldConditions.find(c => c.field === 'account'),
          oldConditions.find(c => c.field === 'account'),
        ) ||
        !deepEqual(
          stripType(oldConditions.find(c => c.field === 'date') || {}),
          stripType(newConditions.find(c => c.field === 'date') || {}),
        )
      ) {
        await setNextDate({
          id: schedule.id,
          conditions: newConditions,
          reset: true,
        });
      }
    } else if (resetNextDate) {
      await setNextDate({ id: schedule.id, reset: true });
    }

    await db.updateWithSchema('schedules', schedule);
  });

  return schedule.id;
}

export async function deleteSchedule({ id }) {
  const { data: ruleId } = await aqlQuery(
    q('schedules').filter({ id }).calculate('rule'),
  );

  await batchMessages(async () => {
    await db.delete_('rules', ruleId);
    await db.delete_('schedules', id);
  });
}

async function skipNextDate({ id }) {
  return setNextDate({
    id,
    start: nextDate => {
      return d.addDays(parseDate(nextDate), 1);
    },
  });
}

function discoverSchedules() {
  return findSchedules();
}

export async function exportSchedules() {
  const { data } = await aqlQuery(q('schedules').select('*'));
  const schedules = data as ScheduleEntity[];
  const rulesById = new Map(getRules().map(rule => [rule.id, rule]));

  const [accounts, payees, categories, categoryMappings, payeeMappings] =
    await Promise.all([
      db.getAccounts(),
      db.getPayees(),
      db.getCategories(),
      db.all<db.DbCategoryMapping>('SELECT * FROM category_mapping'),
      db.all<db.DbPayeeMapping>('SELECT * FROM payee_mapping'),
    ]);
  const categoryRowsWithGroups = await db.all<{
    id: string;
    name: string;
    groupName: string | null;
  }>(
    `SELECT c.id as id, c.name as name, cg.name as groupName
       FROM categories c
       LEFT JOIN category_groups cg ON cg.id = c.cat_group
      WHERE c.tombstone = 0`,
  );
  const accountNamesById = new Map(
    accounts.map(account => [account.id, account.name]),
  );
  const payeeNamesById = new Map(payees.map(payee => [payee.id, payee.name]));
  const categoryNamesById = new Map(
    categories.map(category => [category.id, category.name]),
  );
  const categoryGroupNamesById = new Map(
    categoryRowsWithGroups.map(category => [category.id, category.groupName]),
  );
  const payeeNamesByTargetId = new Map(
    payees.map(payee => [payee.id, payee.name]),
  );
  const categoryNamesByTransferId = new Map(
    categories.map(category => [category.id, category.name]),
  );
  const categoryGroupNamesByTransferId = new Map(
    categoryRowsWithGroups.map(category => [category.id, category.groupName]),
  );

  for (const mapping of payeeMappings) {
    const targetName = payeeNamesByTargetId.get(mapping.targetId);
    if (targetName) {
      payeeNamesById.set(mapping.id, targetName);
    }
  }

  for (const mapping of categoryMappings) {
    const transferName = categoryNamesByTransferId.get(mapping.transferId);
    const transferGroupName = categoryGroupNamesByTransferId.get(
      mapping.transferId,
    );
    if (transferName) {
      categoryNamesById.set(mapping.id, transferName);
    }
    if (transferGroupName) {
      categoryGroupNamesById.set(mapping.id, transferGroupName);
    }
  }

  const payload: ScheduleTransferPayload = {
    version: SCHEDULE_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    schedules: schedules.map(schedule => {
      const serializedRule = rulesById.get(schedule.rule)?.serialize();
      const conditionsSource = Array.isArray(serializedRule?.conditions)
        ? serializedRule.conditions
        : Array.isArray(schedule._conditions)
          ? schedule._conditions
          : [];
      const actionsSource = Array.isArray(serializedRule?.actions)
        ? serializedRule.actions
        : Array.isArray(schedule._actions)
          ? schedule._actions
          : [];
      const conditions = mapRuleEntriesForExport(
        cloneJSON(conditionsSource),
        {
          accountNamesById,
          payeeNamesById,
          categoryNamesById,
          categoryGroupNamesById,
        },
      );
      const actions = mapRuleEntriesForExport(cloneJSON(actionsSource), {
        accountNamesById,
        payeeNamesById,
        categoryNamesById,
        categoryGroupNamesById,
      }).filter(action => !(isObject(action) && action.op === 'link-schedule'));

      return {
        name: schedule.name ?? null,
        posts_transaction: Boolean(schedule.posts_transaction),
        completed: Boolean(schedule.completed),
        rule: {
          stage: serializedRule?.stage ?? null,
          conditionsOp: serializedRule?.conditionsOp ?? 'and',
          conditions,
          actions,
        },
      };
    }),
  };

  return JSON5.stringify(payload, null, 2);
}

export async function importSchedules({
  content,
}: {
  content: string;
}): Promise<ScheduleImportResult> {
  const payload = parseScheduleTransfer(content);

  const [accounts, payees, categoryRowsWithGroups] = await Promise.all([
    db.getAccounts(),
    db.getPayees(),
    db.all<{ id: string; name: string; groupName: string | null }>(
      `SELECT c.id as id, c.name as name, cg.name as groupName
         FROM categories c
         LEFT JOIN category_groups cg ON cg.id = c.cat_group
        WHERE c.tombstone = 0`,
    ),
  ]);
  const { idsByName: accountIdsByName, ambiguousNames: accountAmbiguousNames } =
    buildNameLookup(accounts);
  const { idsByName: payeeIdsByName, ambiguousNames: payeeAmbiguousNames } =
    buildNameLookup(payees);
  const categoryLookup = buildCategoryLookup(categoryRowsWithGroups);

  const result: ScheduleImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (const scheduleItem of payload.schedules) {
    let importedScheduleId: string | null = null;
    const scheduleName = scheduleItem?.name ?? null;
    try {
      if (!isObject(scheduleItem)) {
        throw new Error('Invalid schedule entry');
      }
      if (!isObject(scheduleItem.rule)) {
        throw new Error('Missing schedule rule payload');
      }
      if (!Array.isArray(scheduleItem.rule.conditions)) {
        throw new Error('Schedule rule conditions must be an array');
      }
      if (!Array.isArray(scheduleItem.rule.actions)) {
        throw new Error('Schedule rule actions must be an array');
      }

      const mappedConditions = await mapRuleEntriesForImport(
        cloneJSON(scheduleItem.rule.conditions),
        {
          accountIdsByName,
          accountAmbiguousNames,
          payeeIdsByName,
          payeeAmbiguousNames,
          categoryLookup,
        },
      );
      const mappedActions = await mapRuleEntriesForImport(
        cloneJSON(scheduleItem.rule.actions),
        {
          accountIdsByName,
          accountAmbiguousNames,
          payeeIdsByName,
          payeeAmbiguousNames,
          categoryLookup,
        },
      );
      const importedScheduleName =
        typeof scheduleItem.name === 'string' ? scheduleItem.name : null;

      importedScheduleId = await createSchedule({
        schedule: {
          name: importedScheduleName,
          posts_transaction: Boolean(scheduleItem.posts_transaction),
          completed: Boolean(scheduleItem.completed),
        },
        conditions: mappedConditions,
      });

      const linkedRule = await getRuleForSchedule(importedScheduleId);
      const actionsWithoutLink = mappedActions.filter(
        action => !(isObject(action) && action.op === 'link-schedule'),
      );
      await updateRule({
        id: linkedRule.id,
        stage: scheduleItem.rule.stage ?? null,
        conditionsOp: scheduleItem.rule.conditionsOp ?? 'and',
        conditions: mappedConditions,
        actions: [
          { op: 'link-schedule', value: importedScheduleId },
          ...actionsWithoutLink,
        ],
      });

      result.imported++;
    } catch (error) {
      if (importedScheduleId) {
        try {
          await deleteSchedule({ id: importedScheduleId });
        } catch (cleanupError) {
          captureException(cleanupError);
        }
      }

      result.skipped++;
      result.errors.push({
        scheduleName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function getUpcomingDates({ config, count }) {
  const rules = recurConfigToRSchedule(config);

  try {
    const schedule = new RSchedule({ rrules: rules });

    return schedule
      .occurrences({ start: d.startOfDay(new Date()), take: count })
      .toArray()
      .map(date =>
        config.skipWeekend
          ? getDateWithSkippedWeekend(date.date, config.weekendSolveMode)
          : date.date,
      )
      .map(date => dayFromDate(date));
  } catch (err) {
    captureBreadcrumb(config);
    throw err;
  }
}

// Services

function onRuleUpdate(rule) {
  const { actions, conditions } =
    rule instanceof Rule ? rule.serialize() : ruleModel.toJS(rule);

  if (actions && actions.find(a => a.op === 'link-schedule')) {
    const scheduleId = actions.find(a => a.op === 'link-schedule').value;

    if (scheduleId) {
      const conds = extractScheduleConds(conditions);

      const payeeIdx = conditions.findIndex(c => c === conds.payee);
      const accountIdx = conditions.findIndex(c => c === conds.account);
      const amountIdx = conditions.findIndex(c => c === conds.amount);
      const dateIdx = conditions.findIndex(c => c === conds.date);

      db.runQuery(
        'INSERT OR REPLACE INTO schedules_json_paths (schedule_id, payee, account, amount, date) VALUES (?, ?, ?, ?, ?)',
        [
          scheduleId,
          payeeIdx === -1 ? null : `$[${payeeIdx}]`,
          accountIdx === -1 ? null : `$[${accountIdx}]`,
          amountIdx === -1 ? null : `$[${amountIdx}]`,
          dateIdx === -1 ? null : `$[${dateIdx}]`,
        ],
      );
    }
  }
}

function trackJSONPaths() {
  // Populate the table
  db.transaction(() => {
    getRules().forEach(rule => {
      onRuleUpdate(rule);
    });
  });

  return addSyncListener(onApplySync);
}

function onApplySync(oldValues, newValues) {
  newValues.forEach((items, table) => {
    if (table === 'rules') {
      items.forEach(newValue => {
        onRuleUpdate(newValue);
      });
    }
  });
}

// This is the service that move schedules forward automatically and
// posts transactions

async function postTransactionForSchedule({
  id,
  today,
}: {
  id: string;
  today?: boolean;
}) {
  const { data } = await aqlQuery(q('schedules').filter({ id }).select('*'));
  const schedule = data[0];
  if (schedule == null || schedule._account == null) {
    return;
  }

  const transaction = {
    payee: schedule._payee,
    account: schedule._account,
    amount: getScheduledAmount(schedule._amount),
    date: today ? currentDay() : schedule.next_date,
    schedule: schedule.id,
    cleared: false,
  };

  if (transaction.account) {
    await addTransactions(transaction.account, [transaction]);
  }
}

// TODO: make this sequential

async function advanceSchedulesService(syncSuccess) {
  // Move all paid schedules
  const { data: schedules } = await aqlQuery(
    q('schedules')
      .filter({ completed: false, '_account.closed': false })
      .select('*'),
  );

  const { data: hasTransData } = await aqlQuery(
    getHasTransactionsQuery(schedules),
  );
  const hasTrans = new Set(
    hasTransData.filter(Boolean).map(row => row.schedule),
  );

  const failedToPost = [];
  let didPost = false;

  const { data: upcomingLength } = await aqlQuery(
    q('preferences')
      .filter({ id: 'upcomingScheduledTransactionLength' })
      .select('value'),
  );

  for (const schedule of schedules) {
    const status = getStatus(
      schedule.next_date,
      schedule.completed,
      hasTrans.has(schedule.id),
      upcomingLength[0]?.value ?? '7',
    );

    if (status === 'paid') {
      if (schedule._date) {
        // Move forward recurring schedules
        if (schedule._date.frequency) {
          try {
            await setNextDate({ id: schedule.id });
          } catch {
            // This might error if the rule is corrupted and it can't
            // find the rule
          }
        } else {
          if (schedule._date < currentDay()) {
            // Complete any single schedules
            await updateSchedule({
              schedule: { id: schedule.id, completed: true },
            });
          }
        }
      }
    } else if (
      (status === 'due' || status === 'missed') &&
      schedule.posts_transaction &&
      schedule._account
    ) {
      // Automatically create a transaction for due schedules
      if (syncSuccess) {
        await postTransactionForSchedule({ id: schedule.id });

        didPost = true;
      } else {
        failedToPost.push(schedule._payee);
      }
    }
  }

  if (failedToPost.length > 0) {
    connection.send('schedules-offline');
  } else if (didPost) {
    // This forces a full refresh of transactions because it
    // simulates them coming in from a full sync. This not a
    // great API right now, but I think generally the approach
    // is sane to treat them as external sync events.
    connection.send('sync-event', {
      type: 'success',
      tables: ['transactions'],
      syncDisabled: false,
    });
  }
}

export type SchedulesHandlers = {
  'schedule/create': typeof createSchedule;
  'schedule/update': typeof updateSchedule;
  'schedule/delete': typeof deleteSchedule;
  'schedule/skip-next-date': typeof skipNextDate;
  'schedule/post-transaction': typeof postTransactionForSchedule;
  'schedule/force-run-service': typeof advanceSchedulesService;
  'schedule/discover': typeof discoverSchedules;
  'schedule/get-upcoming-dates': typeof getUpcomingDates;
  'schedule/export': typeof exportSchedules;
  'schedule/import': typeof importSchedules;
};

// Expose functions to the client
export const app = createApp<SchedulesHandlers>();

app.method('schedule/create', mutator(undoable(createSchedule)));
app.method('schedule/update', mutator(undoable(updateSchedule)));
app.method('schedule/delete', mutator(undoable(deleteSchedule)));
app.method('schedule/skip-next-date', mutator(undoable(skipNextDate)));
app.method(
  'schedule/post-transaction',
  mutator(undoable(postTransactionForSchedule)),
);
app.method(
  'schedule/force-run-service',
  mutator(() => advanceSchedulesService(true)),
);
app.method('schedule/discover', discoverSchedules);
app.method('schedule/get-upcoming-dates', getUpcomingDates);
app.method('schedule/export', exportSchedules);
app.method('schedule/import', mutator(importSchedules));

app.service(trackJSONPaths);

app.events.on('sync', ({ type }) => {
  const completeEvent =
    type === 'success' || type === 'error' || type === 'unauthorized';

  if (completeEvent && prefs.getPrefs()) {
    if (!db.getDatabase()) {
      logger.info('database is not available, skipping schedule service');
      return;
    }

    const { lastScheduleRun } = prefs.getPrefs();
    if (lastScheduleRun !== currentDay()) {
      runMutator(() => advanceSchedulesService(type === 'success'));

      prefs.savePrefs({ lastScheduleRun: currentDay() });
    }
  }
});
