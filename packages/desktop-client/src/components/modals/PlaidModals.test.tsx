import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { initServer } from '@actual-app/core/platform/client/connection';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TestProviders } from '#mocks';

import { PlaidInitialiseModal } from './PlaidInitialiseModal';
import { PlaidLinkModal } from './PlaidLinkModal';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
vi.mock('#components/common/Modal', () => ({
  Modal: ({
    children,
  }: {
    children: (state: { state: { close: () => void } }) => ReactNode;
  }) => children({ state: { close: vi.fn() } }),
  ModalHeader: () => null,
  ModalCloseButton: () => null,
  ModalButtons: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('#hooks/useCurrentAccess', () => ({
  useCurrentAccess: () => ({ cloudFileId: 'budget-file', isAdmin: true }),
}));

const slotWarning = /Each new connection uses one of the Trial plan/;

function renderLinkModal(trialPlan: boolean) {
  initServer({
    'plaid-items': async () => ({
      items: [
        {
          itemId: 'item-1',
          institutionId: 'ins_1',
          institutionName: 'First Platypus Bank',
          products: ['transactions'],
        },
      ],
    }),
  });
  render(
    <TestProviders>
      <MemoryRouter>
        <PlaidLinkModal trialPlan={trialPlan} />
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('PlaidLinkModal', () => {
  it('defaults to an existing connection on the Trial plan', async () => {
    renderLinkModal(true);
    expect(
      await screen.findByRole('radio', { name: 'Use an existing connection' }),
    ).toBeChecked();
    expect(screen.getByText('First Platypus Bank')).toBeVisible();
    expect(screen.getByText(slotWarning)).toBeVisible();
  });

  it('defaults to a new bank otherwise', async () => {
    renderLinkModal(false);
    expect(
      await screen.findByRole('radio', { name: 'Link a new bank' }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Use an existing connection' }),
    ).not.toBeChecked();
    expect(screen.queryByText(slotWarning)).toBeNull();
  });
});

describe('PlaidLinkModal with Hosted Link', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.Actual.openURLInBrowser = vi.fn();
  });
  afterEach(() => vi.useRealTimers());

  it('opens Plaid and exchanges its token, even after a failed check', async () => {
    const exchange = vi.fn(async () => ({
      item: {
        itemId: 'item-2',
        institutionId: null,
        institutionName: null,
        products: [],
      },
    }));
    const linkToken = vi.fn(async () => ({
      linkToken: 'link-1',
      hostedLinkUrl: 'https://secure.plaid.com/hl/1',
    }));
    const result = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ status: 'success', publicToken: 'public-1' });
    initServer({
      'plaid-items': async () => ({ items: [] }),
      'plaid-link-token': linkToken,
      'plaid-link-result': result,
      'plaid-exchange': exchange,
      'plaid-accounts': async () => [],
    });
    render(
      <TestProviders>
        <PlaidLinkModal trialPlan={false} />
      </TestProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Finish in the Plaid window/)).toBeVisible();
    expect(window.Actual.openURLInBrowser).toHaveBeenCalledWith(
      'https://secure.plaid.com/hl/1',
    );

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() =>
      expect(exchange).toHaveBeenCalledWith({ publicToken: 'public-1' }),
    );
    expect(result).toHaveBeenCalledTimes(2);
    expect(linkToken).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('does not open Plaid after the dialog closes', async () => {
    let resolveToken: (link: {
      linkToken: string;
      hostedLinkUrl: string;
    }) => void = () => {
      throw new Error('Link token request has not started');
    };
    const linkToken = vi.fn(
      () =>
        new Promise<{ linkToken: string; hostedLinkUrl: string }>(resolve => {
          resolveToken = resolve;
        }),
    );
    initServer({
      'plaid-items': async () => ({ items: [] }),
      'plaid-link-token': linkToken,
    });
    const { unmount } = render(
      <TestProviders>
        <PlaidLinkModal trialPlan={false} />
      </TestProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(linkToken).toHaveBeenCalledOnce());
    unmount();
    resolveToken({
      linkToken: 'link-1',
      hostedLinkUrl: 'https://secure.plaid.com/hl/1',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(window.Actual.openURLInBrowser).not.toHaveBeenCalled();
  });
});

describe('PlaidInitialiseModal', () => {
  it('checks the saved countries', () => {
    renderInitialiseModal(false);
    expect(
      screen.getByRole('checkbox', { name: 'United States' }),
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Canada' })).not.toBeChecked();
  });

  it('keeps edits to this budget once credentials exist', () => {
    renderInitialiseModal(true);
    const toggle = screen.getByRole('checkbox', {
      name: 'For this budget only',
    });
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByText('All budgets'));
    expect(toggle).not.toBeChecked();
  });

  it('saves the first setup globally by default', () => {
    renderInitialiseModal(false);
    expect(
      screen.getByRole('checkbox', { name: 'For this budget only' }),
    ).not.toBeChecked();
  });
});

function renderInitialiseModal(configured: boolean) {
  render(
    <TestProviders>
      <PlaidInitialiseModal
        onSuccess={vi.fn()}
        configured={configured}
        trialPlan={false}
        countryCodes={['US']}
      />
    </TestProviders>,
  );
}
