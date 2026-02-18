import { Fragment, useMemo, useState } from 'react';
import type {
  ComponentProps,
  ComponentPropsWithoutRef,
  ReactElement,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { SvgAdd } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { TextOneLine } from '@actual-app/components/text-one-line';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css, cx } from '@emotion/css';

import { getNormalisedString } from 'loot-core/shared/normalisation';

import { Autocomplete, defaultFilterSuggestion } from './Autocomplete';
import type { AutocompleteItem, AutocompleteItemProps } from './Autocomplete';
import { ItemHeader } from './ItemHeader';

import { compareBySubgroupOrder } from '@desktop-client/accounts/accountSubgroups';
import { useAccounts } from '@desktop-client/hooks/useAccounts';

/**
 * Suggested account subgroup choices based on YNAB account classifications.
 * Values are stored and displayed in title case.
 */
const SUBGROUP_SUGGESTIONS = [
  'Checking',
  'Savings',
  'Cash',
  'Credit Card',
  'Line of Credit',
  'Other Asset',
  'Other Liability',
  'Mortgage',
  'Auto Loan',
  'Student Loan',
  'Personal Loan',
  'Medical Debt',
  'Other Debt',
] as const;

type AccountSubgroupItem = AutocompleteItem & {
  id: string;
  name: string;
  group: 'used' | 'other';
};

const NEW_ITEM_ID = 'new';
const NEW_ITEM_PREFIX = `${NEW_ITEM_ID}:`;

function makeNew(id: string, rawValue: string): string {
  if (id === NEW_ITEM_ID && !rawValue.startsWith(NEW_ITEM_PREFIX)) {
    return NEW_ITEM_PREFIX + rawValue;
  }
  return id;
}

function stripNew(value: string | null | undefined): string | null {
  if (typeof value === 'string' && value.startsWith(NEW_ITEM_PREFIX)) {
    return NEW_ITEM_ID;
  }
  return value ?? null;
}

type AccountSubgroupItemWithIndex = AccountSubgroupItem & {
  highlightedIndex: number;
};

type AccountSubgroupListProps = {
  items: AccountSubgroupItem[];
  getItemProps: (arg: { item: AccountSubgroupItem }) => AutocompleteItemProps;
  highlightedIndex: number;
  embedded?: boolean;
  maxHeight?: number;
  inputValue: string;
  renderCreateButton?: (
    props: ComponentPropsWithoutRef<typeof CreateAccountSubgroupButton>,
  ) => ReactElement<typeof CreateAccountSubgroupButton>;
  renderItemGroupHeader?: (
    props: ComponentPropsWithoutRef<typeof ItemHeader>,
  ) => ReactElement<typeof ItemHeader>;
  renderItem?: (
    props: ComponentPropsWithoutRef<typeof AccountSubgroupItemComponent>,
  ) => ReactElement<typeof AccountSubgroupItemComponent>;
};

function AccountSubgroupList({
  items,
  getItemProps,
  highlightedIndex,
  embedded,
  maxHeight,
  inputValue,
  renderCreateButton = defaultRenderCreateButton,
  renderItemGroupHeader = defaultRenderItemGroupHeader,
  renderItem = defaultRenderItem,
}: AccountSubgroupListProps) {
  const { t } = useTranslation();
  const listMaxHeight = maxHeight ?? (!embedded ? 175 : undefined);

  const { newItem, usedSubgroups, otherSubgroups } = useMemo(() => {
    let currentIndex = 0;
    let newItem: AccountSubgroupItemWithIndex | null = null;
    const usedSubgroups: AccountSubgroupItemWithIndex[] = [];
    const otherSubgroups: AccountSubgroupItemWithIndex[] = [];

    for (const item of items) {
      const indexedItem = { ...item, highlightedIndex: currentIndex++ };

      if (item.id === NEW_ITEM_ID) {
        newItem = indexedItem;
      } else if (item.group === 'used') {
        usedSubgroups.push(indexedItem);
      } else {
        otherSubgroups.push(indexedItem);
      }
    }

    return {
      newItem,
      usedSubgroups,
      otherSubgroups,
    };
  }, [items]);

  function renderAccountSubgroupItem(item: AccountSubgroupItemWithIndex) {
    const { type: _unusedType, ...itemProps } = getItemProps({
      item,
    }) as Record<string, unknown>;
    return renderItem({
      ...itemProps,
      type: 'button' as const,
      item,
      highlighted: highlightedIndex === item.highlightedIndex,
      embedded,
    });
  }

  return (
    <View>
      <View
        style={{
          overflow: 'auto',
          padding: '5px 0',
          ...(listMaxHeight ? { maxHeight: listMaxHeight } : {}),
        }}
      >
        {newItem &&
          renderCreateButton({
            ...getItemProps({ item: newItem }),
            subgroupName: inputValue,
            highlighted: newItem.highlightedIndex === highlightedIndex,
            embedded,
          })}

        {usedSubgroups.length > 0 &&
          renderItemGroupHeader({ title: t('In Use') })}
        {usedSubgroups.map(item => (
          <Fragment key={item.id}>{renderAccountSubgroupItem(item)}</Fragment>
        ))}

        {otherSubgroups.length > 0 &&
          renderItemGroupHeader({ title: t('Suggested') })}
        {otherSubgroups.map(item => (
          <Fragment key={item.id}>{renderAccountSubgroupItem(item)}</Fragment>
        ))}
      </View>
    </View>
  );
}

function customSort(obj: AccountSubgroupItem, value: string): number {
  const name = getNormalisedString(obj.name);
  if (obj.id === NEW_ITEM_ID) {
    return -3;
  }
  if (obj.group === 'used' && name.includes(value)) {
    return -2;
  }
  if (name.includes(value)) {
    return -1;
  }
  return 1;
}

function filterSuggestions(
  allSuggestions: AccountSubgroupItem[],
  filterValue: string,
) {
  const normalizedValue = getNormalisedString(filterValue);
  const filtered = allSuggestions
    .filter(suggestion => {
      if (suggestion.id === NEW_ITEM_ID) {
        return filterValue !== '';
      }
      return defaultFilterSuggestion(suggestion, filterValue);
    })
    .sort(
      (a, b) => customSort(a, normalizedValue) - customSort(b, normalizedValue),
    );

  // If exact match found anywhere in results, remove the create option.
  const hasExactMatch = filtered.some(
    suggestion =>
      suggestion.id !== NEW_ITEM_ID &&
      getNormalisedString(suggestion.name) === normalizedValue,
  );
  if (hasExactMatch) {
    return filtered.filter(suggestion => suggestion.id !== NEW_ITEM_ID);
  }
  return filtered;
}

export type AccountSubgroupAutocompleteProps = {
  value?: string | null;
  inputProps?: ComponentProps<
    typeof Autocomplete<AccountSubgroupItem>
  >['inputProps'];
  embedded?: boolean;
  maxHeight?: number;
  closeOnBlur?: boolean;
  onUpdate?: (id: string, value: string) => void;
  onSelect?: (id: string, value: string) => void;
  renderCreateButton?: (
    props: ComponentPropsWithoutRef<typeof CreateAccountSubgroupButton>,
  ) => ReactElement<typeof CreateAccountSubgroupButton>;
  renderItemGroupHeader?: (
    props: ComponentPropsWithoutRef<typeof ItemHeader>,
  ) => ReactElement<typeof ItemHeader>;
  renderItem?: (
    props: ComponentPropsWithoutRef<typeof AccountSubgroupItemComponent>,
  ) => ReactElement<typeof AccountSubgroupItemComponent>;
};

export function AccountSubgroupAutocomplete({
  value,
  inputProps,
  embedded,
  maxHeight,
  closeOnBlur,
  onUpdate,
  onSelect,
  renderCreateButton = defaultRenderCreateButton,
  renderItemGroupHeader = defaultRenderItemGroupHeader,
  renderItem = defaultRenderItem,
}: AccountSubgroupAutocompleteProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();

  const [rawInput, setRawInput] = useState('');
  const hasInput = rawInput.length > 0;

  const { usedOnBudgetSubgroups, usedOffBudgetSubgroups } = useMemo(() => {
    const onBudget = new Set<string>();
    const offBudget = new Set<string>();
    for (const account of accounts) {
      if (!account.subgroup) {
        continue;
      }
      if (account.offbudget === 1) {
        offBudget.add(account.subgroup);
      } else {
        onBudget.add(account.subgroup);
      }
    }
    return {
      usedOnBudgetSubgroups: onBudget,
      usedOffBudgetSubgroups: offBudget,
    };
  }, [accounts]);

  const suggestions: AccountSubgroupItem[] = useMemo(() => {
    const onBudgetOrderBySubgroup = new Map<string, number>();
    const offBudgetOrderBySubgroup = new Map<string, number>();
    for (const account of accounts) {
      if (!account.subgroup || account.subgroup_sort_order == null) {
        continue;
      }
      if (account.offbudget === 1) {
        if (!offBudgetOrderBySubgroup.has(account.subgroup)) {
          offBudgetOrderBySubgroup.set(
            account.subgroup,
            account.subgroup_sort_order,
          );
        }
      } else if (!onBudgetOrderBySubgroup.has(account.subgroup)) {
        onBudgetOrderBySubgroup.set(
          account.subgroup,
          account.subgroup_sort_order,
        );
      }
    }

    const orderedOnBudget = [...usedOnBudgetSubgroups].sort((a, b) => {
      return compareBySubgroupOrder(a, b, onBudgetOrderBySubgroup);
    });
    const orderedOffBudget = [...usedOffBudgetSubgroups].sort((a, b) => {
      return compareBySubgroupOrder(a, b, offBudgetOrderBySubgroup);
    });

    const seenNames = new Set<string>();
    const usedItems: AccountSubgroupItem[] = [];
    for (const name of [...orderedOnBudget, ...orderedOffBudget]) {
      if (seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);
      usedItems.push({
        id: name,
        name,
        group: 'used',
      } satisfies AccountSubgroupItem);
    }

    const otherItems: AccountSubgroupItem[] = SUBGROUP_SUGGESTIONS.filter(
      name => !seenNames.has(name),
    ).map(
      name =>
        ({
          id: name,
          name,
          group: 'other',
        }) satisfies AccountSubgroupItem,
    );

    const allItems = [...usedItems, ...otherItems];

    if (!hasInput) {
      return allItems;
    }

    return [
      {
        id: NEW_ITEM_ID,
        name: '',
        group: 'other',
      } satisfies AccountSubgroupItem,
      ...allItems,
    ];
  }, [accounts, usedOnBudgetSubgroups, usedOffBudgetSubgroups, hasInput]);

  function handleSelect(id: string, rawInputValue: string) {
    if (id === NEW_ITEM_ID) {
      onSelect?.(rawInputValue, rawInputValue);
    } else {
      onSelect?.(id, rawInputValue);
    }
  }

  return (
    <Autocomplete
      strict
      embedded={embedded}
      value={stripNew(value)}
      suggestions={suggestions}
      closeOnBlur={closeOnBlur}
      itemToString={item => {
        if (!item) {
          return '';
        }
        if (item.id === NEW_ITEM_ID) {
          return rawInput;
        }
        return item.name;
      }}
      inputProps={{
        ...inputProps,
        autoCapitalize: 'words',
        onBlur: e => {
          inputProps?.onBlur?.(e);
          setRawInput('');
        },
        'aria-label': inputProps?.['aria-label'] ?? t('Account Subgroup'),
        onChangeValue: (value, event) => {
          inputProps?.onChangeValue?.(value, event);
          setRawInput(value);
        },
      }}
      onUpdate={(id, inputValue) => onUpdate?.(id, makeNew(id, inputValue))}
      onSelect={handleSelect}
      getHighlightedIndex={filteredSuggestions => {
        if (filteredSuggestions.length === 0) {
          return null;
        }
        if (filteredSuggestions[0].id === NEW_ITEM_ID) {
          return filteredSuggestions.length > 1 ? 1 : 0;
        }
        return 0;
      }}
      filterSuggestions={filterSuggestions}
      renderItems={(items, getItemProps, idx, inputValue) => (
        <AccountSubgroupList
          items={items}
          getItemProps={getItemProps}
          highlightedIndex={idx}
          inputValue={inputValue ?? ''}
          embedded={embedded}
          maxHeight={maxHeight}
          renderCreateButton={renderCreateButton}
          renderItemGroupHeader={renderItemGroupHeader}
          renderItem={renderItem}
        />
      )}
    />
  );
}

// --- Create button ---

type CreateAccountSubgroupButtonProps = ComponentPropsWithoutRef<
  typeof View
> & {
  subgroupName: string;
  highlighted?: boolean;
  embedded?: boolean;
};

export function CreateAccountSubgroupButton({
  subgroupName,
  highlighted,
  embedded,
  style,
  ...props
}: CreateAccountSubgroupButtonProps) {
  const { isNarrowWidth } = useResponsive();
  const narrowStyle = isNarrowWidth ? { ...styles.mobileMenuItem } : {};
  const iconSize = isNarrowWidth ? 14 : 8;

  return (
    <View
      data-testid="create-account-subgroup-button"
      style={{
        display: 'block',
        flex: '1 0',
        color: highlighted
          ? theme.menuAutoCompleteTextHover
          : theme.noticeTextMenu,
        borderRadius: embedded ? 4 : 0,
        fontSize: 11,
        fontWeight: 500,
        padding: '6px 9px',
        backgroundColor: highlighted
          ? theme.menuAutoCompleteBackgroundHover
          : 'transparent',
        ':active': {
          backgroundColor: theme.menuAutoCompleteBackgroundHover,
        },
        ...narrowStyle,
        ...style,
      }}
      {...props}
    >
      <SvgAdd
        width={iconSize}
        height={iconSize}
        style={{ marginRight: 5, display: 'inline-block' }}
      />
      <Trans>Create subgroup "{{ subgroupName }}"</Trans>
    </View>
  );
}

function defaultRenderCreateButton(
  props: ComponentPropsWithoutRef<typeof CreateAccountSubgroupButton>,
): ReactElement<typeof CreateAccountSubgroupButton> {
  return <CreateAccountSubgroupButton {...props} />;
}

function defaultRenderItemGroupHeader(
  props: ComponentPropsWithoutRef<typeof ItemHeader>,
): ReactElement<typeof ItemHeader> {
  return <ItemHeader {...props} type="account-subgroup" />;
}

// --- Account subgroup item ---

type AccountSubgroupItemComponentProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'children'
> & {
  item: AccountSubgroupItem;
  highlighted?: boolean;
  embedded?: boolean;
};

function AccountSubgroupItemComponent({
  item,
  className,
  highlighted,
  embedded,
  ...props
}: AccountSubgroupItemComponentProps) {
  const { isNarrowWidth } = useResponsive();
  const narrowStyle = isNarrowWidth
    ? {
        ...styles.mobileMenuItem,
        borderRadius: 0,
        borderTop: `1px solid ${theme.pillBorder}`,
      }
    : {};

  return (
    <button
      type="button"
      className={cx(
        className,
        css({
          display: 'block',
          width: '100%',
          backgroundColor: highlighted
            ? theme.menuAutoCompleteBackgroundHover
            : 'transparent',
          color: highlighted
            ? theme.menuAutoCompleteItemTextHover
            : theme.menuAutoCompleteItemText,
          borderRadius: embedded ? 4 : 0,
          padding: 4,
          paddingLeft: 20,
          border: 'none',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'default',
          ...narrowStyle,
        }),
      )}
      data-testid={`${item.name}-account-subgroup-item`}
      data-highlighted={highlighted || undefined}
      {...props}
    >
      <TextOneLine>{item.name ?? ''}</TextOneLine>
    </button>
  );
}

function defaultRenderItem(
  props: ComponentPropsWithoutRef<typeof AccountSubgroupItemComponent>,
): ReactElement<typeof AccountSubgroupItemComponent> {
  return <AccountSubgroupItemComponent {...props} />;
}
