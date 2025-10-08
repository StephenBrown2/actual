// @ts-strict-ignore
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { Select } from '@actual-app/components/select';

import { currencies } from 'loot-core/shared/currencies';

type CurrencySelectProps = {
  value: string;
  onChange: (code: string) => void;
  includeNoneOption?: boolean;
  style?: CSSProperties;
  className?: string;
  disabled?: boolean;
};

export function CurrencySelect({
  value,
  onChange,
  includeNoneOption = true,
  style,
  className,
  disabled,
}: CurrencySelectProps) {
  const { t } = useTranslation();

  const currencyTranslations = useMemo(
    () =>
      new Map<string, string>([
        ['', t('None')],
        ['AED', t('UAE Dirham')],
        ['ARS', t('Argentinian Peso')],
        ['AUD', t('Australian Dollar')],
        ['BRL', t('Brazilian Real')],
        ['CAD', t('Canadian Dollar')],
        ['CHF', t('Swiss Franc')],
        ['CNY', t('Yuan Renminbi')],
        ['CRC', t('Costa Rican Colón')],
        ['EGP', t('Egyptian Pound')],
        ['EUR', t('Euro')],
        ['GBP', t('Pound Sterling')],
        ['HKD', t('Hong Kong Dollar')],
        ['INR', t('Indian Rupee')],
        ['JMD', t('Jamaican Dollar')],
        ['LKR', t('Sri Lankan Rupee')],
        ['MDL', t('Moldovan Leu')],
        ['PHP', t('Philippine Peso')],
        ['PLN', t('Polish Złoty')],
        ['QAR', t('Qatari Riyal')],
        ['RON', t('Romanian Leu')],
        ['RSD', t('Serbian Dinar')],
        ['RUB', t('Russian Ruble')],
        ['SAR', t('Saudi Riyal')],
        ['SEK', t('Swedish Krona')],
        ['SGD', t('Singapore Dollar')],
        ['THB', t('Thai Baht')],
        ['TRY', t('Turkish Lira')],
        ['UAH', t('Ukrainian Hryvnia')],
        ['USD', t('US Dollar')],
        ['UZS', t('Uzbek Soum')],
      ]),
    [t],
  );

  const currencyOptions: [string, string][] = currencies
    .filter(currency => {
      // Filter out "None" option if includeNoneOption is false
      if (!includeNoneOption && currency.code === '') {
        return false;
      }
      return true;
    })
    .map(currency => {
      const translatedName =
        currencyTranslations.get(currency.code) ?? currency.name;
      if (currency.code === '') {
        return [currency.code, translatedName];
      }
      return [
        currency.code,
        `${currency.code} - ${translatedName} (${currency.symbol})`,
      ];
    });

  return (
    <Select
      value={value}
      onChange={onChange}
      options={currencyOptions}
      style={style}
      className={className}
      disabled={disabled}
    />
  );
}
