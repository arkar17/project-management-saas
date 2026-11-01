import { useState } from 'react';
import { getThemePreference, setThemePreference, type ThemePreference } from '../lib/theme';
import { SelectField } from './ui/select';

export function ThemeSelect({ hideLabel }: { hideLabel?: boolean }) {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);
  return (
    <SelectField
      label="Theme"
      hideLabel={hideLabel}
      value={pref}
      onChange={(e) => {
        const next = e.target.value as ThemePreference;
        setPref(next);
        setThemePreference(next);
      }}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </SelectField>
  );
}
