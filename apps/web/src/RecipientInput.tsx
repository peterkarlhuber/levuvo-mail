import { useEffect, useId, useRef, useState } from 'react';
import { getJson } from './api';

type Contact = { email: string; name: string };

/** Comma-separated address field with suggestions for the address currently being typed. */
export default function RecipientInput({
  accountId,
  label,
  value,
  onChange,
  placeholder,
  autoFocus = false
}: {
  accountId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const timer = useRef<number | null>(null);
  const token = value.split(/[,;]/).at(-1)?.trim() || '';

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (token.length < 2 || token.includes(' ')) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    timer.current = window.setTimeout(() => {
      getJson<{ contacts: Contact[] }>(`/api/contacts?q=${encodeURIComponent(token)}`, accountId, controller.signal)
        .then(result => {
          const existing = new Set(value.split(/[,;]/).map(v => v.trim().toLowerCase()));
          setSuggestions(
            result.contacts.filter(
              c => !existing.has(c.email.toLowerCase()) || c.email.toLowerCase() === token.toLowerCase()
            )
          );
          setActive(0);
        })
        .catch(() => setSuggestions([]));
    }, 180);
    return () => {
      controller.abort();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [token, accountId, value]);

  const choose = (contact: Contact) => {
    const parts = value
      .split(/[,;]/)
      .map(v => v.trim())
      .filter(Boolean);
    parts.pop();
    onChange([...parts, contact.email].join(', ') + ', ');
    setSuggestions([]);
    setOpen(false);
  };
  const visible = open && suggestions.length > 0;

  return (
    <label className="recipient-field">
      {label}
      <span className="recipient-control">
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={e => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (!visible) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(i => Math.min(suggestions.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(i => Math.max(0, i - 1));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(suggestions[active]);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        {visible && (
          <ul className="recipient-suggestions" id={listId} role="listbox">
            {suggestions.map((contact, index) => (
              <li
                key={contact.email}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : ''}
                onMouseDown={e => {
                  e.preventDefault();
                  choose(contact);
                }}
              >
                <strong>{contact.name || contact.email}</strong>
                {contact.name && <small>{contact.email}</small>}
              </li>
            ))}
          </ul>
        )}
      </span>
    </label>
  );
}
