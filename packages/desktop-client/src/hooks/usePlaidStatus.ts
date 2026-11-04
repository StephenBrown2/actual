import { useEffect, useState } from 'react';

import { sendCatch } from '@actual-app/core/platform/client/connection';
import type { PlaidStatus } from '@actual-app/core/types/models';

import { useSyncServerStatus } from './useSyncServerStatus';

export function usePlaidStatus(enabled: boolean) {
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus>({});
  const status = useSyncServerStatus();

  useEffect(() => {
    if (!enabled || status !== 'online') {
      setPlaidStatus({});
      return;
    }
    void sendCatch('plaid-status').then(({ data }) =>
      setPlaidStatus(data ?? {}),
    );
  }, [enabled, status]);

  return { plaidStatus, setPlaidStatus };
}
