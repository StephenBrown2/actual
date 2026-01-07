import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useState,
} from 'react';

import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import ReactTextareaAutocomplete from '@webscopeio/react-textarea-autocomplete';
import '@webscopeio/react-textarea-autocomplete/style.css';

import { type TagEntity } from 'loot-core/types/models';

import { useTagCSS } from '@desktop-client/hooks/useTagCSS';
import { useTags } from '@desktop-client/hooks/useTags';

type TagItemProps = {
  entity: TagEntity;
};

function TagItem({ entity }: TagItemProps) {
  const getTagStyle = useTagCSS();

  return (
    <div
      style={{
        padding: '4px 8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        ...styles.smallText,
      }}
    >
      <span
        className={getTagStyle(entity.tag, {
          color: entity.color,
          compact: true,
        })}
      >
        #{entity.tag}
      </span>
      {entity.description && (
        <span
          style={{
            color: theme.menuAutoCompleteText,
            opacity: 0.7,
          }}
        >
          {entity.description}
        </span>
      )}
    </div>
  );
}

function LoadingComponent() {
  return (
    <div
      style={{
        padding: '4px 8px',
        color: theme.menuAutoCompleteText,
        ...styles.smallText,
      }}
    >
      Loading...
    </div>
  );
}

type NotesInputProps = {
  value: string;
  onUpdate?: (value: string) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onFocus?: () => void;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  shouldSaveFromKey?: (e: KeyboardEvent) => boolean;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  focused?: boolean;
  variant?: 'desktop' | 'mobile';
};

export function NotesInput({
  value: defaultValue,
  onUpdate,
  onBlur,
  onKeyDown,
  onFocus,
  onChange,
  shouldSaveFromKey,
  style,
  placeholder,
  disabled,
  focused,
  variant = 'desktop',
}: NotesInputProps) {
  const tags = useTags();
  const [value, setValue] = useState(defaultValue);
  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);

  // Sync internal state with external value
  if (prevDefaultValue !== defaultValue) {
    setValue(defaultValue);
    setPrevDefaultValue(defaultValue);
  }

  const handleChange = (
    e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    setValue(e.target.value);
    onChange?.(e as ChangeEvent<HTMLTextAreaElement>);
  };

  const handleFocus = () => {
    onFocus?.();
  };

  const handleBlur = (e: FocusEvent<HTMLTextAreaElement>) => {
    onBlur?.(e as unknown as FocusEvent);
    if (document.hasFocus()) {
      onUpdate?.(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Only let Enter and Tab propagate (for navigation)
    if (e.key !== 'Enter' && e.key !== 'Tab') {
      e.stopPropagation();
    }

    // Don't trigger save when autocomplete is open - let the library handle selection
    if (isAutocompleteOpen && (e.key === 'Enter' || e.key === 'Tab')) {
      return;
    }

    onKeyDown?.(e as unknown as KeyboardEvent);

    if (shouldSaveFromKey?.(e as unknown as KeyboardEvent)) {
      onUpdate?.(value);
    }
  };

  const filterTags = (token: string): TagEntity[] => {
    if (!token) return tags.slice(0, 10);
    const lowerToken = token.toLowerCase();
    return tags
      .filter(tag => tag.tag.toLowerCase().includes(lowerToken))
      .slice(0, 10);
  };

  // Desktop styling (table cell)
  const inputCellStyle: CSSProperties = {
    padding: '5px 3px',
    margin: '0 1px',
  };

  // Mobile styling (full input field)
  const mobileInputStyle: CSSProperties = {
    borderWidth: 1,
    borderColor: theme.formInputBorder,
    borderStyle: 'solid',
    marginLeft: 8,
    marginRight: 8,
    height: styles.mobileMinHeight,
    borderRadius: 4,
    padding: '0 10px',
    backgroundColor: disabled
      ? theme.formInputTextReadOnlySelection
      : theme.tableBackground,
    color: disabled ? theme.tableTextInactive : theme.tableText,
  };

  const containerStyle: CSSProperties = {
    width: variant === 'mobile' ? 'auto' : '100%',
    display: 'flex',
    alignItems: 'center',
    ...(variant === 'mobile' ? mobileInputStyle : inputCellStyle),
    ...style,
  };

  const textareaStyle: CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    padding: 0,
    margin: 0,
    resize: 'none',
    overflow: 'hidden',
    ...(variant === 'desktop' ? styles.smallText : {}),
  };

  const dropdownStyle: CSSProperties = {
    backgroundColor: theme.menuAutoCompleteBackground,
    color: theme.menuAutoCompleteText,
    borderRadius: 4,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.1)',
    minWidth: 150,
    maxHeight: 200,
    overflow: 'auto',
    zIndex: 10000,
    ...styles.smallText,
  };

  const listStyle: CSSProperties = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  };

  const itemStyle: CSSProperties = {
    backgroundColor: 'transparent',
  };

  // Add global CSS overrides since the library's CSS has high specificity
  return (
    <>
      <style>
        {`
          .rta__autocomplete {
            background-color: ${theme.menuAutoCompleteBackground} !important;
            color: ${theme.menuAutoCompleteText} !important;
          }
          .rta__list {
            background: ${theme.menuAutoCompleteBackground} !important;
            border-color: ${theme.menuAutoCompleteBackground} !important;
          }
          .rta__entity {
            background: ${theme.menuAutoCompleteBackground} !important;
            color: ${theme.menuAutoCompleteText} !important;
          }
          .rta__entity--selected {
            background: ${theme.menuAutoCompleteBackgroundHover} !important;
            color: ${theme.menuAutoCompleteText} !important;
          }
          .rta__item:not(:last-child) {
            border-bottom-color: ${theme.menuAutoCompleteBackgroundHover} !important;
          }
        `}
      </style>
      <ReactTextareaAutocomplete<TagEntity>
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={focused}
        rows={1}
        loadingComponent={LoadingComponent}
        style={textareaStyle}
        containerStyle={containerStyle}
        dropdownStyle={dropdownStyle}
        listStyle={listStyle}
        itemStyle={itemStyle}
        onItemSelected={() => setIsAutocompleteOpen(false)}
        onItemHighlighted={({ item }) => setIsAutocompleteOpen(item !== null)}
        trigger={{
          '#': {
            dataProvider: filterTags,
            component: TagItem,
            output: (item: TagEntity) => `#${item.tag}`,
          },
        }}
      />
    </>
  );
}
