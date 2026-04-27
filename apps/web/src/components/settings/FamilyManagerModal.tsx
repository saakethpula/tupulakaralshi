import type { FormEvent } from "react";
import type { CurrentUserResponse } from "../../lib/api";

type FamilyManagerModalProps = {
    open: boolean;
    busyAction: string;
    profile: CurrentUserResponse;
    selectedGroupId: string;
    selectedGroup: CurrentUserResponse["groups"][number] | null;
    marketsCount: number;
    joinCode: string;
    setJoinCode: (value: string) => void;
    referralJoinCode: string;
    selectedGroupInviteUrl: string;
    minBet: string;
    setMinBet: (value: string) => void;
    maxBet: string;
    setMaxBet: (value: string) => void;
    requireVenmoForBets: boolean;
    setRequireVenmoForBets: (value: boolean) => void;
    onClose: () => void;
    onSelectGroup: (groupId: string) => void;
    onJoinGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onCopyInviteLink: (joinCode: string) => Promise<void>;
    onRemoveMember: (groupId: string, memberId: string, memberName: string) => Promise<void>;
    onDeleteGroup: (groupId: string, groupName: string) => Promise<void>;
    onSaveBetLimits: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function FamilyManagerModal({
    open,
    busyAction,
    profile,
    selectedGroupId,
    selectedGroup,
    marketsCount,
    joinCode,
    setJoinCode,
    referralJoinCode,
    selectedGroupInviteUrl,
    minBet,
    setMinBet,
    maxBet,
    setMaxBet,
    requireVenmoForBets,
    setRequireVenmoForBets,
    onClose,
    onSelectGroup,
    onJoinGroup,
    onCopyInviteLink,
    onRemoveMember,
    onDeleteGroup,
    onSaveBetLimits
}: FamilyManagerModalProps) {
    if (!open) {
        return null;
    }

    return (
        <section className="settings-overlay" aria-label="Manage family">
            <button
                className="settings-backdrop"
                type="button"
                aria-label="Close family manager"
                onClick={onClose}
            />
            <article className="panel settings-panel settings-modal family-manager-modal">
                <div className="panel-heading settings-modal-heading">
                    <div>
                        <p className="kicker">Family manager</p>
                        <h2>{selectedGroup?.name ?? "Manage your families"}</h2>
                    </div>
                    <button
                        className="toolbar-button toolbar-button-secondary"
                        type="button"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </div>

                <div className="family-manager-grid">
                    <div className="family-manager-column">
                        <div className="compact-form family-summary-card">
                            <strong>{selectedGroup?.name ?? "Choose a family group"}</strong>
                            <p className="subtle-copy">
                                {selectedGroup
                                    ? `Join code ${selectedGroup.joinCode}`
                                    : "Create a group or join one with a code."}
                            </p>
                            <div className="family-strip-meta">
                                <div className="compact-metric">
                                    <span className="metric-label">Members</span>
                                    <strong>{selectedGroup?.members.length ?? 0}</strong>
                                </div>
                                <div className="compact-metric">
                                    <span className="metric-label">Visible markets</span>
                                    <strong>{marketsCount}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="compact-form">
                            <span className="subtle-copy">Switch family</span>
                            <div className="group-selector vertical">
                                {profile.groups.map((group) => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        className={selectedGroupId === group.id ? "group-pill active" : "group-pill"}
                                        onClick={() => onSelectGroup(group.id)}
                                    >
                                        <span>{group.name}</span>
                                        <strong>{group.role}</strong>
                                        <small>{group.joinCode}</small>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="family-manager-column">
                        {!referralJoinCode ? (
                            <form onSubmit={(event) => void onJoinGroup(event)} className="form-stack compact-form">
                                <span className="subtle-copy">Join another family group</span>
                                <input
                                    value={joinCode}
                                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                                    placeholder="Join code"
                                    required
                                />
                                <button className="ghost-button" type="submit" disabled={busyAction === "join-group"}>
                                    Join group
                                </button>
                            </form>
                        ) : null}

                        {selectedGroup ? (
                            <div className="compact-form">
                                <strong className="subtle-copy">Invite people</strong>
                                <p className="subtle-copy invite-link-copy">{selectedGroupInviteUrl}</p>
                                <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => void onCopyInviteLink(selectedGroup.joinCode)}
                                >
                                    Copy invite link
                                </button>
                            </div>
                        ) : null}

                        {selectedGroup && selectedGroup.role === "ADMIN" ? (
                            <div className="form-stack compact-form">
                                <form className="form-stack" onSubmit={(event) => void onSaveBetLimits(event)}>
                                    <span className="subtle-copy">Per-market limits</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="15"
                                        value={minBet}
                                        onChange={(event) => setMinBet(event.target.value)}
                                        placeholder="Minimum bet"
                                        required
                                    />
                                    <input
                                        type="number"
                                        min="1"
                                        max="15"
                                        value={maxBet}
                                        onChange={(event) => setMaxBet(event.target.value)}
                                        placeholder="Maximum per market"
                                        required
                                    />
                                    <label className="subtle-copy" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={requireVenmoForBets}
                                            onChange={(event) => setRequireVenmoForBets(event.target.checked)}
                                        />
                                        Require creator Venmo confirmation before stakes go live
                                    </label>
                                    <button className="ghost-button" type="submit" disabled={busyAction === "bet-limits"}>
                                        Save limits
                                    </button>
                                </form>
                                <span className="subtle-copy">Manage members</span>
                                {selectedGroup.members
                                    .filter((member) => member.id !== profile.user.id)
                                    .map((member) => (
                                        <div key={member.id} className="member-card member-management-row">
                                            <div>
                                                <strong>{member.displayName}</strong>
                                                <span>{member.role}</span>
                                            </div>
                                            <button
                                                className="ghost-button"
                                                type="button"
                                                disabled={busyAction === `remove-member-${member.id}`}
                                                onClick={() => void onRemoveMember(selectedGroup.id, member.id, member.displayName)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                <button
                                    className="toolbar-button toolbar-button-secondary"
                                    type="button"
                                    disabled={busyAction === `delete-group-${selectedGroup.id}`}
                                    onClick={() => void onDeleteGroup(selectedGroup.id, selectedGroup.name)}
                                >
                                    Delete family
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </article>
        </section>
    );
}
