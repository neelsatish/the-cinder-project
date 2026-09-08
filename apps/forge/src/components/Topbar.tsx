import { useState, type FormEvent } from "react";
import { Bell, MagnifyingGlass, PaintBrushBroad, UserCircle, WifiHigh, WifiSlash, X } from "@phosphor-icons/react";

import { useForgeTheme } from "../theme";

type TopbarProps = {
  profileName: string;
  online: boolean;
  onSearch: (query: string) => void;
  onSwitchAccount: () => void;
  onOpenConnection: () => void;
};

const THEME_CYCLE: Array<"ember-glass" | "nightdesk" | "forge-brutalist"> = ["ember-glass", "nightdesk", "forge-brutalist"];

function ThemeSwitch() {
  const { theme, toggleTheme, themeLabel } = useForgeTheme();
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  const label = `Switch to ${themeLabel(nextTheme)}`;
  return <button type="button" className="forge-icon-btn" onClick={toggleTheme} title={label} aria-label={label}><PaintBrushBroad size={19} /></button>;
}

export function Topbar({ profileName, online, onSearch, onSwitchAccount, onOpenConnection }: TopbarProps) {
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    onSearch(query.trim());
  }

  const initials = profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

  return (
    <header className="forge-topbar">
      <form className="forge-search" role="search" onSubmit={handleSearch}>
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes and documents" aria-label="Search your notes and documents" />
        <button type="submit" className="forge-search-submit">Search</button>
      </form>
      <div className="forge-topbar-actions">
        <div className="forge-popover-anchor">
          <button type="button" className="forge-icon-btn" title="Notifications" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}><Bell size={19} /></button>
          {notificationsOpen ? <div className="forge-popover forge-menu-popover notification-empty"><PopoverTitle title="Notifications" onClose={() => setNotificationsOpen(false)} /><Bell size={24} /><p>Nothing new.</p></div> : null}
        </div>
        <ThemeSwitch />
        <div className="forge-popover-anchor">
          <button type="button" className="forge-avatar" title="Account" aria-label="Open account menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }}>
            {initials ? <span>{initials}</span> : <UserCircle size={20} />}
          </button>
          {profileOpen ? <div className="forge-popover profile-editor">
            <PopoverTitle title="Account" onClose={() => setProfileOpen(false)} />
            <strong>{profileName}</strong>
            <p className="account-connection-state">{online ? <WifiHigh size={16} /> : <WifiSlash size={16} />}{online ? "Connected to school" : "Working offline"}</p>
            <button type="button" className="forge-button secondary" onClick={() => { setProfileOpen(false); onOpenConnection(); }}>School connection</button>
            <button type="button" className="forge-button secondary" onClick={onSwitchAccount}>Switch account</button>
          </div> : null}
        </div>
      </div>
    </header>
  );
}

function PopoverTitle({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="forge-popover-title"><strong>{title}</strong><button type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={17} /></button></div>;
}
