# Plaid Setup

<ExperimentalFeatureWarning />

:::warning
All functionality described here may not be available in the latest stable release. Turn it on under **Settings → Experimental → Plaid Bank Sync**. See [Experimental Features](../../experimental/index.md) for instructions to enable experimental features. Use the `nightly` images for the latest implementation.
:::

### Create a Plaid Account

1. Sign up at the [Plaid Dashboard](https://dashboard.plaid.com/signup).
2. Under **Developers → Keys**, copy your **client ID** and the secret for the environment you will use.
3. Start in **Sandbox**, which uses test banks and costs nothing.
4. Before linking real banks, verify your email and apply for Trial or Production access in the Plaid Dashboard. Switch Actual to **Production** once Plaid approves it.

:::info Trial plan limits
The Trial plan allows **10 Production bank connections for the lifetime of the team**. Sandbox connections do not count. Removing a connection does not give the slot back, and linking the same bank again uses a new slot. Actual helps you keep slots:

- Unlinking an account in Actual keeps its Plaid connection, so you can link it again for free.
- When a bank asks you to log in again, **Reauthorize** repairs the existing connection instead of creating a new one.
- A connection you already made in another budget can be reused (see below).
:::

### Set Up Plaid in Actual

1. Click **+ Add account** at the bottom of the sidebar.
2. Select **Set up bank sync**. This opens the **Bank Sync** page in Settings.

   <img width="518" alt="The Add account dialog with the Set up bank sync button highlighted" src="/img/advanced/bank-sync/bank-sync-add-account-modal@2x.webp" />

3. Under **Providers**, click **Set up** on the **Plaid** card.

   <img width="644" alt="The Providers section of the Bank Sync page with Set up on the Plaid card highlighted" src="/img/advanced/bank-sync/plaid-set-up@2x.webp" />

4. Enter your **Client ID** and **Secret**, choose the **Environment**, and tick **My Plaid team is on the Trial plan** if it applies. Set the switch to **This budget only** to keep these credentials to the current budget. Once credentials exist, the switch starts there, so changing them in one budget does not change the others.
5. Under **Countries and regions**, tick the countries of your banks. In Production, choose only countries your Plaid team is approved for, because Plaid rejects the others. United States is ticked by default.

   <img width="512" alt="The Set up Plaid dialog with the switch set to This budget only, empty Client ID and Secret fields, the Sandbox environment, the Trial plan checkbox and the country list with United States ticked" src="/img/advanced/bank-sync/plaid-setup-modal@2x.webp" />

6. Click **Save and continue**.

### Link an Account

1. Click **Link bank account** on the **Plaid** card.

   <img width="644" alt="The Providers section of the Bank Sync page with Link bank account on the configured Plaid card highlighted" src="/img/advanced/bank-sync/plaid-link-bank-account@2x.webp" />

2. Choose **Link a new bank**, or **Use an existing connection** to reuse a bank you linked in another budget without using a new slot. With the Trial plan box ticked, reusing is the default. Click **Continue**.

   <img width="512" alt="The Link a bank with Plaid dialog with Link a new bank selected and the Continue button highlighted" src="/img/advanced/bank-sync/plaid-link-modal@2x.webp" />

3. For a new bank, Plaid opens in a new window. Find your bank, sign in, and pick the accounts to share. Banks that sign in on their own website work the same way, because Plaid handles that step. When you finish, Actual continues on its own. If you closed the Plaid window by mistake, click **Open Plaid again**. Reusing a connection skips this step.

   <img width="512" alt="The Link a bank with Plaid dialog waiting for the Plaid window, with an Open Plaid again button" src="/img/advanced/bank-sync/plaid-waiting@2x.webp" />

4. In **Link Accounts**, click **Set up bank sync** next to each account you want, and choose an existing Actual account or create a new one. Then click **Link accounts**.

   <img width="990" alt="The Link Accounts dialog listing the Plaid accounts, with an Allow button in the Quantity column and the first Set up bank sync button highlighted" src="/img/advanced/bank-sync/plaid-link-accounts@2x.webp" />

A new account imports the last 30 days by default, which Plaid loads first. To import more, set an earlier **Starting date**, up to two years back. Linking then waits until Plaid has loaded the older history, which can take several minutes. Older rows that arrive later are left out, so the starting balance stays correct.

Moving the starting balance transaction to an earlier date does not import older transactions on the next sync, because Plaid sends each transaction only once. To import them, move the starting balance earlier, unlink the account, and link it again to the same Actual account through **Use an existing connection**. Actual then imports from the starting balance's date, up to two years back, and skips transactions it already has. The starting balance amount does not change, so adjust it to keep the account balance right.

With **Currency support** and **Multiple currencies** turned on, an account in a currency Actual supports keeps that currency, and one in a currency other than your budget's becomes a foreign-currency account. Otherwise, and for currencies Actual does not support, the account uses your budget currency.

### How Syncing Works

- Pending transactions follow the **Import pending transactions** option. When Plaid links a posted transaction to its pending one, Actual updates the pending transaction in place, including a changed amount (a tip, for example), unless you have reconciled it. Without that link, Actual matches them only when the amount is the same within seven days, so a pending transaction may be left behind for you to delete.
- Transactions your bank removes are left in Actual for you to review.
- **Unlink account** keeps the Plaid connection. **Remove from Plaid** in the account menu deletes the connection at Plaid, which stops syncing for every account that uses it, in every budget.

### Investment Accounts

Investment accounts link with the **Investment Account** option turned on, so only the balance is imported. Use the [reconcile tool](../../accounts/reconciliation.md) to bring it into your budget.

Actual offers to sync an investment account's **quantity** instead when all of these are true:

- Apart from cash, the account holds a single security, and its ticker or currency code is a currency Actual supports.
- That currency is not your budget currency.
- **Currency support** and **Multiple currencies** are turned on, and your budget has a currency set.

To accept, tick the account's box in the **Quantity** column of **Link Accounts**. On a phone, the checkbox is on the account's card.

With quantity sync, the account becomes a foreign-currency account in that currency. Buys, sells and interest import as the quantity, at the value your brokerage reports. If your budget currency differs from the brokerage's, Actual uses your saved rate for that day. The account balance is the quantity you hold.

Plaid's Investments product must be enabled on your Plaid team. If a connection was made without it, **Allow** in the **Quantity** column (**Allow investment access** on a phone) asks your bank for it. Accounts that do not meet these conditions stay balance-only.
