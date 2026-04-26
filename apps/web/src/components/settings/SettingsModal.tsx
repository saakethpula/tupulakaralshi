import type { FormEvent } from "react";
import type { CurrentUserResponse } from "../../lib/api";
import type { ResolvedTheme, ThemePreference } from "../../types/app";

type SettingsModalProps = {
    open: boolean;
    busyAction: string;
    profile: CurrentUserResponse;
    selectedGroupName: string;
    groupName: string;
    setGroupName: (value: string) => void;
    venmoHandle: string;
    setVenmoHandle: (value: string) => void;
    themePreference: ThemePreference;
    resolvedTheme: ResolvedTheme;
    setThemePreference: (value: ThemePreference) => void;
    onClose: () => void;
    onOpenFamilyManager: () => void;
    onCreateGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onSaveVenmoHandle: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onRestartTutorial: () => Promise<void>;
};

export function SettingsModal({
    open,
    busyAction,
    profile,
    selectedGroupName,
    groupName,
    setGroupName,
    venmoHandle,
    setVenmoHandle,
    themePreference,
    resolvedTheme,
    setThemePreference,
    onClose,
    onOpenFamilyManager,
    onCreateGroup,
    onSaveVenmoHandle,
    onRestartTutorial
}: SettingsModalProps) {
    if (!open) {
        return null;
    }

    return (
        <section className="settings-overlay" aria-label="Settings">
            <button
                className="settings-backdrop"
                type="button"
                aria-label="Close settings"
                onClick={onClose}
            />
            <article className="panel settings-panel settings-modal">
                <div className="panel-heading settings-modal-heading">
                    <div>
                        <p className="kicker">Settings</p>
                        <h2>Personal settings</h2>
                    </div>
                    <button
                        className="toolbar-button toolbar-button-secondary"
                        type="button"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </div>
                <div className="settings-grid">
                    <form onSubmit={(event) => void onSaveVenmoHandle(event)} className="form-stack compact-form">
                        <span className="subtle-copy">Your Venmo handle for payment instructions</span>
                        <input
                            value={venmoHandle}
                            onChange={(event) => setVenmoHandle(event.target.value)}
                            placeholder="@yourhandle"
                            required
                        />
                        <button
                            className="secondary-button"
                            type="submit"
                            disabled={busyAction === "venmo"}
                        >
                            Save Venmo
                        </button>
                    </form>

                    <div className="form-stack compact-form">
                        <span className="subtle-copy">Family groups</span>
                        <strong>{selectedGroupName}</strong>
                        <p className="subtle-copy">
                            Switch families, copy invite links, and manage members in a separate popup.
                        </p>
                        <button
                            className="primary-button"
                            type="button"
                            onClick={onOpenFamilyManager}
                        >
                            Manage family
                        </button>
                    </div>

                    <form onSubmit={(event) => void onCreateGroup(event)} className="form-stack compact-form">
                        <span className="subtle-copy">Create a new family group</span>
                        <input
                            value={groupName}
                            onChange={(event) => setGroupName(event.target.value)}
                            placeholder="The Parkers"
                            required
                        />
                        <button className="primary-button" type="submit" disabled={busyAction === "create-group"}>
                            Create group
                        </button>
                    </form>

                    <div className="form-stack compact-form">
                        <span className="subtle-copy">Appearance</span>
                        <strong>{resolvedTheme === "dark" ? "Dark mode active" : "Light mode active"}</strong>
                        <select
                            value={themePreference}
                            onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
                            aria-label="Theme preference"
                        >
                            <option value="system">Match device setting</option>
                            <option value="light">Light mode</option>
                            <option value="dark">Dark mode</option>
                        </select>
                    </div>

                    <div className="form-stack compact-form">
                        <span className="subtle-copy">Tutorial status</span>
                        <strong>
                            {profile.user.hasCompletedTutorial ? "Completed" : "Not completed yet"}
                        </strong>
                        <button
                            className="toolbar-button toolbar-button-secondary"
                            type="button"
                            disabled={busyAction === "tutorial-reset"}
                            onClick={() => void onRestartTutorial()}
                        >
                            Redo tutorial
                        </button>
                    </div>
                </div>
            </article>
        </section>
    );
}
