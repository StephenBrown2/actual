import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly settings: Locator;
  readonly exportDataButton: Locator;
  readonly switchBudgetTypeButton: Locator;
  readonly advancedSettingsButton: Locator;
  readonly experimentalSettingsButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.settings = page.getByTestId('settings');
    this.exportDataButton = this.settings.getByRole('button', {
      name: 'Export data',
    });
    this.switchBudgetTypeButton = this.settings.getByRole('button', {
      name: /^Switch to (envelope|tracking) budgeting$/i,
    });
    this.advancedSettingsButton =
      this.settings.getByTestId('advanced-settings');
    this.experimentalSettingsButton = this.settings.getByTestId(
      'experimental-settings',
    );
  }

  async waitFor(...options: Parameters<Locator['waitFor']>) {
    await this.settings.waitFor(...options);
  }

  async exportData() {
    await this.exportDataButton.click();
  }

  async useBudgetType(budgetType: 'Envelope' | 'Tracking') {
    await this.switchBudgetTypeButton.waitFor();

    const buttonText = await this.switchBudgetTypeButton.textContent();
    if (buttonText?.includes(budgetType.toLowerCase())) {
      await this.switchBudgetTypeButton.click();
    }
  }

  private async getExperimentalFeatureCheckbox(
    featureName: string,
  ): Promise<Locator> {
    const featureCheckbox = this.page.getByRole('checkbox', {
      name: featureName,
    });

    // If the checkbox is already visible (sections already expanded), use it
    const alreadyVisible = await featureCheckbox
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (alreadyVisible) {
      return featureCheckbox;
    }

    // Expand sections only when collapsed (expand buttons are visible when collapsed)
    if (await this.advancedSettingsButton.isVisible()) {
      await this.advancedSettingsButton.click();
      await this.advancedSettingsButton.waitFor({
        state: 'hidden',
        timeout: 5000,
      });
    }
    if (await this.experimentalSettingsButton.isVisible()) {
      await this.experimentalSettingsButton.click();
      await this.experimentalSettingsButton.waitFor({
        state: 'hidden',
        timeout: 5000,
      });
    }

    await featureCheckbox.waitFor({ state: 'visible', timeout: 15000 });
    return featureCheckbox;
  }

  async enableExperimentalFeature(featureName: string) {
    const featureCheckbox =
      await this.getExperimentalFeatureCheckbox(featureName);
    if (!(await featureCheckbox.isChecked())) {
      await featureCheckbox.click();
      // Synced prefs update after async save; wait for checkbox to reflect state
      await expect(featureCheckbox).toBeChecked({ timeout: 15000 });
    }
  }

  async disableExperimentalFeature(featureName: string) {
    const featureCheckbox =
      await this.getExperimentalFeatureCheckbox(featureName);
    if (await featureCheckbox.isChecked()) {
      await featureCheckbox.click();
      // Synced prefs update after async save; wait for checkbox to reflect state
      await expect(featureCheckbox).not.toBeChecked({ timeout: 15000 });
    }
  }

  /**
   * Select the default currency from the Settings currency dropdown.
   * Call after enabling the "Currency support" experimental feature.
   */
  async selectCurrency(currencyCode: string): Promise<void> {
    const trimmed = currencyCode.trim();
    if (!trimmed) {
      throw new Error(
        'selectCurrency requires a non-empty ISO currency code (e.g. "USD").',
      );
    }

    const dropdownTrigger = this.settings
      .getByRole('button', { name: /^(None|[A-Z]{3} - )/ })
      .first();
    await dropdownTrigger.scrollIntoViewIfNeeded();
    await dropdownTrigger.waitFor({ state: 'visible', timeout: 15000 });
    await dropdownTrigger.click();

    const currencyMenu = this.page.locator('[data-popover]').last();
    await currencyMenu.waitFor({ state: 'visible', timeout: 15000 });
    const currencyOption = currencyMenu.getByRole('button', {
      name: `${trimmed} -`,
    });
    await currencyOption.waitFor({ state: 'visible', timeout: 15000 });
    await currencyOption.click();
  }
}
