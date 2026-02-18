import type { ReactNode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import type { AccountEntity } from 'loot-core/types/models';

import { Accounts } from './Accounts';

import { TestProviders } from '@desktop-client/mocks';

function makeAccount({
  id,
  name,
  offbudget,
  subgroup = null,
}: {
  id: string;
  name: string;
  offbudget: 0 | 1;
  subgroup?: string | null;
}): AccountEntity {
  return {
    id,
    name,
    subgroup,
    offbudget,
    closed: 0,
    sort_order: 0,
    last_reconciled: null,
    tombstone: 0,
    account_id: null,
    bank: null,
    bankName: null,
    bankId: null,
    mask: null,
    official_name: null,
    balance_current: null,
    balance_available: null,
    balance_limit: null,
    account_sync_source: null,
    last_sync: null,
  };
}

const onBudgetAccountsMock = [
  makeAccount({ id: 'on-1', name: 'On Budget One', offbudget: 0 }),
  makeAccount({
    id: 'on-2',
    name: 'Checking Account',
    offbudget: 0,
    subgroup: 'Checking',
  }),
  makeAccount({
    id: 'on-3',
    name: 'Savings Account',
    offbudget: 0,
    subgroup: 'Savings',
  }),
];
const offBudgetAccountsMock = [
  makeAccount({ id: 'off-1', name: 'Off Budget One', offbudget: 1 }),
  makeAccount({
    id: 'off-2',
    name: 'Mortgage Account',
    offbudget: 1,
    subgroup: 'Mortgage',
  }),
  makeAccount({
    id: 'off-3',
    name: 'Other Debt Account',
    offbudget: 1,
    subgroup: 'Other Debt',
  }),
];
const accountsMock = [...onBudgetAccountsMock, ...offBudgetAccountsMock];

vi.mock('@desktop-client/hooks/useAccounts', () => ({
  useAccounts: () => ({ data: accountsMock }),
}));
vi.mock('@desktop-client/hooks/useOnBudgetAccounts', () => ({
  useOnBudgetAccounts: () => ({ data: onBudgetAccountsMock }),
}));
vi.mock('@desktop-client/hooks/useOffBudgetAccounts', () => ({
  useOffBudgetAccounts: () => ({ data: offBudgetAccountsMock }),
}));
vi.mock('@desktop-client/hooks/useClosedAccounts', () => ({
  useClosedAccounts: () => ({ data: [] }),
}));
vi.mock('@desktop-client/hooks/useFailedAccounts', () => ({
  useFailedAccounts: () => new Set<string>(),
}));
vi.mock('@desktop-client/hooks/useUpdatedAccounts', () => ({
  useUpdatedAccounts: () => [],
}));
vi.mock('@desktop-client/hooks/useContextMenu', () => ({
  useContextMenu: () => ({
    setMenuOpen: vi.fn(),
    menuOpen: false,
    handleContextMenu: vi.fn(),
    position: {},
  }),
}));
vi.mock('@desktop-client/hooks/useLocalPref', async () => {
  const { useState } = await import('react');
  return {
    useLocalPref: (prefName: string) => {
      const [expandedKeys, setExpandedKeys] = useState<string[] | undefined>(
        prefName === 'sidebar.expandedKeys'
          ? ['all-accounts', 'onbudget', 'offbudget']
          : undefined,
      );
      const [other, setOther] = useState<unknown>(undefined);
      if (prefName === 'sidebar.expandedKeys') {
        return [expandedKeys, setExpandedKeys, vi.fn()] as const;
      }
      return [other, setOther, vi.fn()] as const;
    },
  };
});

vi.mock('react-router', async () => {
  const actual = await import('react-router');
  return {
    ...actual,
    useMatch: () => null,
  };
});
vi.mock('@desktop-client/components/common/Link', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@desktop-client/components/spreadsheet/CellValue', () => ({
  CellValue: () => <span data-testid="cell-value" />,
}));
vi.mock('./Account', () => ({
  Account: ({ name }: { name: string }) => <div>{name}</div>,
}));
vi.mock('@desktop-client/spreadsheet/bindings', () => ({
  allAccountBalance: vi.fn(() => 'binding'),
  onBudgetAccountBalance: vi.fn(() => 'binding'),
  offBudgetAccountBalance: vi.fn(() => 'binding'),
  closedAccountBalance: vi.fn(() => 'binding'),
  accountBalance: vi.fn(() => 'binding'),
  accountSubgroupBalance: vi.fn(() => 'binding'),
}));

function getGroupToggleButton(label: string): HTMLButtonElement {
  const labelElement = screen.getByText(label);
  const groupRow = labelElement.closest('[role="row"]');
  if (!groupRow) {
    throw new Error(`Could not find row for group: ${label}`);
  }
  const button = groupRow.querySelector(
    'button[aria-label="Collapse"]:not([slot="chevron"]), button[aria-label="Expand"]:not([slot="chevron"])',
  );
  if (button instanceof HTMLButtonElement) {
    return button;
  }
  throw new Error(`Could not find toggle button for group: ${label}`);
}

function toggleGroup(label: string) {
  const toggleButton = getGroupToggleButton(label);
  fireEvent.click(toggleButton);
}

function expandGroupIfCollapsed(label: string) {
  const toggleButton = getGroupToggleButton(label);
  if (toggleButton.getAttribute('aria-label') === 'Expand') {
    fireEvent.click(toggleButton);
  }
}

describe('Accounts sidebar expansion', () => {
  test('allows collapsing and expanding structural groups', async () => {
    render(<Accounts />, { wrapper: TestProviders });

    expandGroupIfCollapsed('All accounts');
    expandGroupIfCollapsed('On budget');
    expandGroupIfCollapsed('Off budget');

    expect(screen.getByText('On Budget One')).toBeInTheDocument();
    expect(screen.getByText('Off Budget One')).toBeInTheDocument();

    toggleGroup('On budget');
    await waitFor(() => {
      expect(screen.queryByText('On Budget One')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Off Budget One')).toBeInTheDocument();

    toggleGroup('On budget');
    await waitFor(() => {
      expect(screen.getByText('On Budget One')).toBeInTheDocument();
    });
  });

  test('does not toggle previously toggled sibling groups', async () => {
    render(<Accounts />, { wrapper: TestProviders });

    expandGroupIfCollapsed('All accounts');
    expandGroupIfCollapsed('On budget');
    expandGroupIfCollapsed('Off budget');

    toggleGroup('On budget');
    await waitFor(() => {
      expect(screen.queryByText('On Budget One')).not.toBeInTheDocument();
    });

    toggleGroup('Off budget');
    await waitFor(() => {
      expect(screen.queryByText('Off Budget One')).not.toBeInTheDocument();
    });

    expect(screen.queryByText('On Budget One')).not.toBeInTheDocument();

    toggleGroup('Off budget');
    await waitFor(() => {
      expect(screen.getByText('Off Budget One')).toBeInTheDocument();
    });
    expect(screen.queryByText('On Budget One')).not.toBeInTheDocument();

    toggleGroup('Mortgage');
    await waitFor(() => {
      expect(screen.queryByText('Mortgage Account')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Other Debt Account')).toBeInTheDocument();

    toggleGroup('Mortgage');
    await waitFor(() => {
      expect(screen.getByText('Mortgage Account')).toBeInTheDocument();
    });
    expect(screen.getByText('Other Debt Account')).toBeInTheDocument();
  });

  test('renders all subgroups in the test budget', () => {
    render(<Accounts />, { wrapper: TestProviders });

    expandGroupIfCollapsed('All accounts');
    expandGroupIfCollapsed('On budget');
    expandGroupIfCollapsed('Off budget');

    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Other Debt')).toBeInTheDocument();
  });
});
