/** Subset of Pluggy Item `connector` merged onto accounts by the sync-server. */
export type PluggyAiConnector = {
  name?: string;
  imageUrl?: string;
  institutionUrl?: string;
};

export type SyncServerPluggyAiAccount = {
  balance: number;
  account_id: string;
  institution?: string;
  orgId?: string;
  name: string;
  subtype?: string | null;
  connectorImageUrl?: string;
  connectorWebsite?: string;
};
