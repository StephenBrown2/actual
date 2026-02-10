import JSON5 from 'json5';
// @ts-strict-ignore
import MockDate from 'mockdate';

import { q } from '../../shared/query';
import { getNextDate } from '../../shared/schedules';
import { aqlQuery } from '../aql';
import * as db from '../db';
import { loadMappings } from '../db/mappings';
import { loadRules, updateRule } from '../transactions/transaction-rules';

import {
  createSchedule,
  deleteSchedule,
  exportSchedules,
  getRuleForSchedule,
  importSchedules,
  setNextDate,
  updateConditions,
  updateSchedule,
} from './app';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

describe('schedule app', () => {
  describe('utility', () => {
    it('conditions are updated when they exist', () => {
      const conds = [
        { op: 'is', field: 'payee', value: 'FOO' },
        { op: 'is', field: 'date', value: '2020-01-01' },
      ];

      const updated = updateConditions(conds, [
        {
          op: 'is',
          field: 'payee',
          value: 'bar',
        },
      ]);

      expect(updated.length).toBe(2);
      expect(updated[0].value).toBe('bar');
    });

    it("conditions are added if they don't exist", () => {
      const conds = [
        { op: 'contains', field: 'payee', value: 'FOO' },
        { op: 'contains', field: 'notes', value: 'dflksjdflskdjf' },
      ];

      const updated = updateConditions(conds, [
        {
          op: 'is',
          field: 'payee',
          value: 'bar',
        },
      ]);

      expect(updated.length).toBe(3);
    });

    it('getNextDate works with date conditions', () => {
      expect(
        getNextDate({ op: 'is', field: 'date', value: '2021-04-30' }),
      ).toBe('2021-04-30');

      expect(
        getNextDate({
          op: 'is',
          field: 'date',
          value: {
            start: '2020-12-20',
            frequency: 'monthly',
            patterns: [
              { type: 'day', value: 15 },
              { type: 'day', value: 30 },
            ],
          },
        }),
      ).toBe('2020-12-30');
    });
  });

  describe('methods', () => {
    it('createSchedule creates a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const {
        data: [row],
      } = await aqlQuery(q('schedules').filter({ id }).select('*'));

      expect(row).toBeTruthy();
      expect(row.rule).toBeTruthy();
      expect(row.next_date).toBe('2020-12-30');

      await expect(
        createSchedule({
          conditions: [{ op: 'is', field: 'payee', value: 'p1' }],
        }),
      ).rejects.toThrow(/date condition is required/);
    });

    it('updateSchedule updates a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          { op: 'is', field: 'payee', value: 'foo' },
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules')
          .filter({ id })
          .select(['next_date', 'posts_transaction']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-30');
      expect(row.posts_transaction).toBe(false);

      MockDate.set(new Date(2021, 4, 17));

      await updateSchedule({
        schedule: { id, posts_transaction: true },
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 18 },
                { type: 'day', value: 29 },
              ],
            },
          },
        ],
      });

      res = await aqlQuery(
        q('schedules')
          .filter({ id })
          .select(['next_date', 'posts_transaction']),
      );
      row = res.data[0];

      // Updating the date condition updates `next_date`
      expect(row.next_date).toBe('2021-05-18');
      expect(row.posts_transaction).toBe(true);
    });

    it('deleteSchedule deletes a schedule', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules.length).toBe(1);

      await deleteSchedule({ id });
      const { data: schedules2 } = await aqlQuery(q('schedules').select('*'));
      expect(schedules2.length).toBe(0);
    });

    it('setNextDate sets `next_date`', async () => {
      const id = await createSchedule({
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 15 },
                { type: 'day', value: 30 },
              ],
            },
          },
        ],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id }).calculate('rule'),
      );

      // Manually update the rule
      await updateRule({
        id: ruleId,
        conditions: [
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2020-12-20',
              frequency: 'monthly',
              patterns: [
                { type: 'day', value: 18 },
                { type: 'day', value: 28 },
              ],
            },
          },
        ],
      });

      let res = await aqlQuery(
        q('schedules').filter({ id }).select(['next_date']),
      );
      let row = res.data[0];

      expect(row.next_date).toBe('2020-12-30');

      await setNextDate({ id });

      res = await aqlQuery(q('schedules').filter({ id }).select(['next_date']));
      row = res.data[0];

      expect(row.next_date).toBe('2021-05-18');
    });

    it('exports schedules in versioned JSON5 format', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const payeeId = await db.insertPayee({ name: 'Groceries' });
      const categoryGroupId = await db.insertCategoryGroup({
        name: 'Expenses',
      });
      const categoryId = await db.insertCategory({
        name: 'Housing',
        cat_group: categoryGroupId,
      });
      const legacyCategoryId = 'legacy-category-id';
      await db.insert('category_mapping', {
        id: legacyCategoryId,
        transferId: categoryId,
      });

      const scheduleId = await createSchedule({
        schedule: { name: 'Rent', posts_transaction: true },
        conditions: [
          { op: 'is', field: 'payee', value: payeeId },
          { op: 'is', field: 'account', value: accountId },
          { op: 'is', field: 'date', value: '2025-01-10' },
          { op: 'is', field: 'amount', value: -10000 },
        ],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id: scheduleId }).calculate('rule'),
      );
      await updateRule({
        id: ruleId,
        stage: 'pre',
        conditionsOp: 'or',
        actions: [
          { op: 'link-schedule', value: scheduleId },
          { op: 'set', field: 'payee', value: payeeId },
          { op: 'set', field: 'category', value: legacyCategoryId },
        ],
      });

      const exported = await exportSchedules();
      const parsed = JSON5.parse(exported);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.schedules)).toBe(true);
      expect(parsed.schedules[0]).toEqual(
        expect.objectContaining({
          name: 'Rent',
          posts_transaction: true,
        }),
      );
      expect(parsed.schedules[0].rule).toEqual(
        expect.objectContaining({
          stage: 'pre',
          conditionsOp: 'or',
        }),
      );
      expect(parsed.schedules[0].rule.conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'account',
            value: 'Checking',
          }),
          expect.objectContaining({
            field: 'payee',
            value: 'Groceries',
          }),
        ]),
      );
      expect(parsed.schedules[0].rule.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set',
            field: 'payee',
            value: 'Groceries',
          }),
          expect.objectContaining({
            op: 'set',
            field: 'category',
            value: 'Housing',
          }),
        ]),
      );
    });

    it('imports schedules by account/payee names and creates missing payees', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const categoryGroupId = await db.insertCategoryGroup({
        name: 'Expenses',
      });
      const categoryId = await db.insertCategory({
        name: 'Housing',
        cat_group: categoryGroupId,
      });
      const content = JSON.stringify({
        version: 1,
        exportedAt: '2026-02-10T00:00:00.000Z',
        schedules: [
          {
            name: 'Imported Schedule',
            posts_transaction: false,
            rule: {
              conditionsOp: 'and',
              conditions: [
                { op: 'is', field: 'payee', value: 'Coffee Shop' },
                { op: 'is', field: 'account', value: 'Checking' },
                { op: 'is', field: 'date', value: '2025-02-01' },
                { op: 'is', field: 'amount', value: -1250 },
              ],
              actions: [
                { op: 'set', field: 'notes', value: 'Imported note' },
                { op: 'set', field: 'payee', value: 'Coffee Shop' },
                { op: 'set', field: 'category', value: 'Housing' },
              ],
            },
          },
        ],
      });

      const result = await importSchedules({ content });
      expect(result).toEqual({
        imported: 1,
        skipped: 0,
        errors: [],
      });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toEqual(
        expect.objectContaining({
          name: 'Imported Schedule',
        }),
      );

      const payee = await db.getPayeeByName('Coffee Shop');
      expect(payee).toBeTruthy();

      const rule = await getRuleForSchedule(schedules[0].id);
      expect(rule.serialize().conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'is',
            field: 'account',
            value: accountId,
          }),
          expect.objectContaining({
            field: 'payee',
            value: payee.id,
          }),
        ]),
      );
      expect(rule.serialize().actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set',
            field: 'notes',
            value: 'Imported note',
          }),
          expect.objectContaining({
            op: 'set',
            field: 'category',
            value: categoryId,
          }),
          expect.objectContaining({
            op: 'link-schedule',
            value: schedules[0].id,
          }),
        ]),
      );
    });

    it('skips schedules with missing accounts and reports errors', async () => {
      const content = JSON.stringify({
        version: 1,
        exportedAt: '2026-02-10T00:00:00.000Z',
        schedules: [
          {
            name: 'Broken Schedule',
            posts_transaction: false,
            rule: {
              conditionsOp: 'and',
              conditions: [
                { op: 'is', field: 'account', value: 'Missing Account' },
                { op: 'is', field: 'date', value: '2025-02-01' },
              ],
              actions: [],
            },
          },
        ],
      });

      const result = await importSchedules({ content });
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          scheduleName: 'Broken Schedule',
        }),
      );
      expect(result.errors[0].message).toContain('Account not found');

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules).toHaveLength(0);
    });

    it('cleans up partially imported schedules when rule update fails', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const content = JSON.stringify({
        version: 1,
        exportedAt: '2026-02-10T00:00:00.000Z',
        schedules: [
          {
            name: 'Bad Stage Schedule',
            posts_transaction: false,
            rule: {
              stage: 'invalid-stage',
              conditionsOp: 'and',
              conditions: [
                { op: 'is', field: 'account', value: 'Checking' },
                { op: 'is', field: 'date', value: '2025-02-01' },
              ],
              actions: [],
            },
          },
        ],
      });

      const result = await importSchedules({ content });
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          scheduleName: 'Bad Stage Schedule',
        }),
      );

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules).toHaveLength(0);

      const rules = await db.all<db.DbRule>(
        'SELECT * FROM rules WHERE tombstone = 0',
      );
      expect(rules).toHaveLength(0);

      // Ensure the created account is still present so this assertion is not a false
      // positive caused by a failed setup.
      expect(accountId).toBeTruthy();
    });

    it('exports schedules with safe fallback when linked rule is missing', async () => {
      const scheduleId = await createSchedule({
        schedule: { name: 'Missing Rule Export', posts_transaction: false },
        conditions: [{ op: 'is', field: 'date', value: '2026-01-01' }],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id: scheduleId }).calculate('rule'),
      );
      await db.delete_('rules', ruleId);

      const exported = await exportSchedules();
      const parsed = JSON5.parse(exported);
      const exportedSchedule = parsed.schedules.find(
        schedule => schedule.name === 'Missing Rule Export',
      );

      expect(exportedSchedule).toBeTruthy();
      expect(exportedSchedule.rule).toEqual(
        expect.objectContaining({
          stage: null,
          conditionsOp: 'and',
          conditions: expect.arrayContaining([
            expect.objectContaining({
              field: 'date',
              op: 'is',
              value: '2026-01-01',
            }),
          ]),
          actions: [],
        }),
      );
    });

    it('round-trips category conditions and actions by name', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const payeeId = await db.insertPayee({ name: 'Rent Payee' });
      const categoryGroupId = await db.insertCategoryGroup({
        name: 'Expenses',
      });
      const housingId = await db.insertCategory({
        name: 'Housing',
        cat_group: categoryGroupId,
      });
      const utilitiesId = await db.insertCategory({
        name: 'Utilities',
        cat_group: categoryGroupId,
      });

      const scheduleId = await createSchedule({
        schedule: { name: 'Roundtrip Categories', posts_transaction: false },
        conditions: [
          { op: 'is', field: 'payee', value: payeeId },
          { op: 'is', field: 'account', value: accountId },
          { op: 'oneOf', field: 'category', value: [housingId, utilitiesId] },
          { op: 'is', field: 'date', value: '2026-01-01' },
          { op: 'is', field: 'amount', value: -5000 },
        ],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id: scheduleId }).calculate('rule'),
      );
      await updateRule({
        id: ruleId,
        actions: [
          { op: 'link-schedule', value: scheduleId },
          { op: 'set', field: 'category', value: utilitiesId },
        ],
      });

      const exported = await exportSchedules();
      await deleteSchedule({ id: scheduleId });
      const importResult = await importSchedules({ content: exported });
      expect(importResult).toEqual({ imported: 1, skipped: 0, errors: [] });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      expect(schedules).toHaveLength(1);
      const importedRule = await getRuleForSchedule(schedules[0].id);
      const { conditions, actions } = importedRule.serialize();

      expect(conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'oneOf',
            field: 'category',
            value: expect.arrayContaining([housingId, utilitiesId]),
          }),
        ]),
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set',
            field: 'category',
            value: utilitiesId,
          }),
        ]),
      );
    });

    it('round-trips mapped category action IDs through names', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const payeeId = await db.insertPayee({ name: 'Payee' });
      const categoryGroupId = await db.insertCategoryGroup({
        name: 'Expenses',
      });
      const categoryId = await db.insertCategory({
        name: 'MappedCategory',
        cat_group: categoryGroupId,
      });
      const mappedCategoryId = 'mapped-category-id';
      await db.insert('category_mapping', {
        id: mappedCategoryId,
        transferId: categoryId,
      });

      const scheduleId = await createSchedule({
        schedule: {
          name: 'Roundtrip Mapped Category',
          posts_transaction: false,
        },
        conditions: [
          { op: 'is', field: 'payee', value: payeeId },
          { op: 'is', field: 'account', value: accountId },
          { op: 'is', field: 'date', value: '2026-01-01' },
          { op: 'is', field: 'amount', value: -5000 },
        ],
      });

      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id: scheduleId }).calculate('rule'),
      );
      await updateRule({
        id: ruleId,
        actions: [
          { op: 'link-schedule', value: scheduleId },
          { op: 'set', field: 'category', value: mappedCategoryId },
        ],
      });

      const exported = await exportSchedules();
      await deleteSchedule({ id: scheduleId });
      const importResult = await importSchedules({ content: exported });
      expect(importResult).toEqual({ imported: 1, skipped: 0, errors: [] });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      const importedRule = await getRuleForSchedule(schedules[0].id);
      expect(importedRule.serialize().actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set',
            field: 'category',
            value: categoryId,
          }),
        ]),
      );
    });

    it('round-trips and recreates payees from exported names', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const payeeId = await db.insertPayee({ name: 'Transient Payee' });

      const scheduleId = await createSchedule({
        schedule: {
          name: 'Roundtrip Payee Recreation',
          posts_transaction: false,
        },
        conditions: [
          { op: 'is', field: 'payee', value: payeeId },
          { op: 'is', field: 'account', value: accountId },
          { op: 'is', field: 'date', value: '2026-01-01' },
          { op: 'is', field: 'amount', value: -5000 },
        ],
      });

      const exported = await exportSchedules();
      await deleteSchedule({ id: scheduleId });
      await db.deletePayee({ id: payeeId });
      expect(await db.getPayeeByName('Transient Payee')).toBeNull();

      const importResult = await importSchedules({ content: exported });
      expect(importResult).toEqual({ imported: 1, skipped: 0, errors: [] });

      const recreatedPayee = await db.getPayeeByName('Transient Payee');
      expect(recreatedPayee).toBeTruthy();
      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      const importedRule = await getRuleForSchedule(schedules[0].id);
      expect(importedRule.serialize().conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'payee',
            value: recreatedPayee.id,
          }),
        ]),
      );
    });

    it('uses exported category group names to disambiguate on import', async () => {
      const accountId = await db.insertAccount({
        name: 'Checking',
        offbudget: 0,
      });
      const payeeId = await db.insertPayee({ name: 'Shared Name Payee' });
      const housingGroupId = await db.insertCategoryGroup({ name: 'Housing' });
      const billsGroupId = await db.insertCategoryGroup({ name: 'Bills' });
      await db.insertCategory({
        name: 'Rent',
        cat_group: housingGroupId,
      });
      const billsRentId = await db.insertCategory({
        name: 'Rent',
        cat_group: billsGroupId,
      });

      const scheduleId = await createSchedule({
        schedule: { name: 'Disambiguate Category', posts_transaction: false },
        conditions: [
          { op: 'is', field: 'payee', value: payeeId },
          { op: 'is', field: 'account', value: accountId },
          { op: 'is', field: 'date', value: '2026-02-01' },
          { op: 'is', field: 'amount', value: -5000 },
        ],
      });
      const { data: ruleId } = await aqlQuery(
        q('schedules').filter({ id: scheduleId }).calculate('rule'),
      );
      await updateRule({
        id: ruleId,
        actions: [
          { op: 'link-schedule', value: scheduleId },
          { op: 'set', field: 'category', value: billsRentId },
        ],
      });

      const exported = await exportSchedules();
      await deleteSchedule({ id: scheduleId });
      const result = await importSchedules({ content: exported });
      expect(result).toEqual({ imported: 1, skipped: 0, errors: [] });

      const { data: schedules } = await aqlQuery(q('schedules').select('*'));
      const importedRule = await getRuleForSchedule(schedules[0].id);
      expect(importedRule.serialize().actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'set',
            field: 'category',
            value: billsRentId,
          }),
        ]),
      );
    });
  });
});
