import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function usePlaidStatus() {
  const [configuredPlaid, setConfiguredPlaid] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const syncServerStatus = useSyncServerStatus();

  useEffect(() => {
    if (syncServerStatus !== 'online') {
      return;
    }

    setIsLoading(true);
    send('plaid-status')
      .then((result: { configured: boolean }) => {
        setConfiguredPlaid(result.configured);
      })
      .catch(() => {
        setConfiguredPlaid(false);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [syncServerStatus]);

  return { configuredPlaid, isLoading };
}
