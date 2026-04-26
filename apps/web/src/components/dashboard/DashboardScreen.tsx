import type { FormEvent } from "react";
import type { CurrentUserResponse, Market } from "../../lib/api";
import { DEFAULT_TRADE_AMOUNT, GENERAL_MARKET_VALUE } from "../../constants/app";
import type { ResolvedTheme, ThemePreference, TradeDraft } from "../../types/app";
import { formatSignedMoney } from "../../utils/format";
import { FamilyManagerModal } from "../settings/FamilyManagerModal";
import { SettingsModal } from "../settings/SettingsModal";
import { MarketCard } from "./MarketCard";

type DashboardScreenProps = {
    profile: CurrentUserResponse;
    selectedGroup: CurrentUserResponse["groups"][number] | null;
    selectedGroupId: string;
    setSelectedGroupId: (groupId: string) => void;
    markets: Market[];
    visibleMembers: CurrentUserResponse["groups"][number]["members"];
    tradeDrafts: Record<string, TradeDraft>;
    question: string;
    setQuestion: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
    targetUserId: string;
    setTargetUserId: (value: string) => void;
    closesAt: string;
    setClosesAt: (value: string) => void;
    groupName: string;
    setGroupName: (value: string) => void;
    joinCode: string;
    setJoinCode: (value: string) => void;
    referralJoinCode: string;
    venmoHandle: string;
    setVenmoHandle: (value: string) => void;
    themePreference: ThemePreference;
    resolvedTheme: ResolvedTheme;
    setThemePreference: (value: ThemePreference) => void;
    selectedGroupInviteUrl: string;
    busyAction: string;
    error: string;
    settingsOpen: boolean;
    setSettingsOpen: (value: boolean | ((current: boolean) => boolean)) => void;
    familyManagerOpen: boolean;
    setFamilyManagerOpen: (value: boolean) => void;
    onOpenFamilyManager: () => void;
    onLogout: () => void;
    onSaveVenmoHandle: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onRestartTutorial: () => Promise<void>;
    onCreateGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onJoinGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onCopyInviteLink: (joinCode: string) => Promise<void>;
    onRemoveGroupMember: (groupId: string, memberId: string, memberName: string) => Promise<void>;
    onDeleteGroup: (groupId: string, groupNameToDelete: string) => Promise<void>;
    onCreateMarket: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onUpdateTradeDraft: (marketId: string, patch: Partial<TradeDraft>) => void;
    onSavePosition: (marketId: string) => Promise<void>;
    onConfirmPosition: (marketId: string, positionId: string) => Promise<void>;
    onRejectPosition: (marketId: string, positionId: string) => Promise<void>;
    onResolve: (marketId: string, resolution: boolean) => Promise<void>;
    onDeleteMarket: (marketId: string) => Promise<void>;
    onMarkPayoutSent: (marketId: string, payoutId: string) => Promise<void>;
    onRespondToPayout: (marketId: string, payoutId: string, received: boolean) => Promise<void>;
};

export function DashboardScreen({
    profile,
    selectedGroup,
    selectedGroupId,
    setSelectedGroupId,
    markets,
    visibleMembers,
    tradeDrafts,
    question,
    setQuestion,
    description,
    setDescription,
    targetUserId,
    setTargetUserId,
    closesAt,
    setClosesAt,
    groupName,
    setGroupName,
    joinCode,
    setJoinCode,
    referralJoinCode,
    venmoHandle,
    setVenmoHandle,
    themePreference,
    resolvedTheme,
    setThemePreference,
    selectedGroupInviteUrl,
    busyAction,
    error,
    settingsOpen,
    setSettingsOpen,
    familyManagerOpen,
    setFamilyManagerOpen,
    onOpenFamilyManager,
    onLogout,
    onSaveVenmoHandle,
    onRestartTutorial,
    onCreateGroup,
    onJoinGroup,
    onCopyInviteLink,
    onRemoveGroupMember,
    onDeleteGroup,
    onCreateMarket,
    onUpdateTradeDraft,
    onSavePosition,
    onConfirmPosition,
    onRejectPosition,
    onResolve,
    onDeleteMarket,
    onMarkPayoutSent,
    onRespondToPayout
}: DashboardScreenProps) {
    return (
        <main className="shell app-shell">
            <section className="dashboard-toolbar">
                <div className="toolbar-meta">
                    <div className="toolbar-balance">
                        <span className="metric-label">Net won / lost</span>
                        <strong>{formatSignedMoney(profile.user.balance)}</strong>
                    </div>
                    <div className="toolbar-actions">
                        <button
                            className="toolbar-button"
                            type="button"
                            onClick={() => setSettingsOpen((current) => !current)}
                        >
                            {settingsOpen ? "Close settings" : "Settings"}
                        </button>
                        <button
                            className="toolbar-button toolbar-button-secondary"
                            onClick={onLogout}
                        >
                            Log out
                        </button>
                    </div>
                </div>
            </section>

            {error ? (
                <section className="status-banner">
                    <strong>{error}</strong>
                </section>
            ) : null}

            <SettingsModal
                open={settingsOpen}
                busyAction={busyAction}
                profile={profile}
                selectedGroupName={selectedGroup ? selectedGroup.name : "No family selected"}
                groupName={groupName}
                setGroupName={setGroupName}
                venmoHandle={venmoHandle}
                setVenmoHandle={setVenmoHandle}
                themePreference={themePreference}
                resolvedTheme={resolvedTheme}
                setThemePreference={setThemePreference}
                onClose={() => setSettingsOpen(false)}
                onOpenFamilyManager={onOpenFamilyManager}
                onCreateGroup={onCreateGroup}
                onSaveVenmoHandle={onSaveVenmoHandle}
                onRestartTutorial={onRestartTutorial}
            />

            <FamilyManagerModal
                open={familyManagerOpen}
                busyAction={busyAction}
                profile={profile}
                selectedGroupId={selectedGroupId}
                selectedGroup={selectedGroup}
                marketsCount={markets.length}
                joinCode={joinCode}
                setJoinCode={setJoinCode}
                referralJoinCode={referralJoinCode}
                selectedGroupInviteUrl={selectedGroupInviteUrl}
                onClose={() => setFamilyManagerOpen(false)}
                onSelectGroup={setSelectedGroupId}
                onJoinGroup={onJoinGroup}
                onCopyInviteLink={onCopyInviteLink}
                onRemoveMember={onRemoveGroupMember}
                onDeleteGroup={onDeleteGroup}
            />

            <section className="dashboard-grid">
                <aside className="sidebar-stack">
                    <article className="panel family-strip family-panel">
                        <div className="panel-heading">
                            <div>
                                <p className="kicker">Current family</p>
                                <h2>{selectedGroup?.name ?? "Choose a family group"}</h2>
                            </div>
                            <button className="toolbar-button toolbar-button-secondary" type="button" onClick={onOpenFamilyManager}>
                                Manage family
                            </button>
                        </div>
                        <div className="family-strip-meta">
                            <div className="compact-metric">
                                <span className="metric-label">Members</span>
                                <strong>{selectedGroup?.members.length ?? 0}</strong>
                            </div>
                            <div className="compact-metric">
                                <span className="metric-label">Visible markets</span>
                                <strong>{markets.length}</strong>
                            </div>
                        </div>
                    </article>

                    <article className="panel leaderboard-panel">
                        <div className="panel-heading">
                            <div>
                                <p className="kicker">Members</p>
                                <h2>Win / loss board</h2>
                            </div>
                        </div>
                        <div className="member-grid sidebar-members">
                            {visibleMembers.map((member) => (
                                <div key={member.id} className="member-card">
                                    <div>
                                        <strong>{member.displayName}</strong>
                                        <span>{member.role}</span>
                                    </div>
                                    <strong>{formatSignedMoney(member.balance)}</strong>
                                </div>
                            ))}
                        </div>
                    </article>
                </aside>

                <section className="main-stack">
                    <article className="panel create-panel">
                        <div className="panel-heading">
                            <div>
                                <p className="kicker">Hidden market</p>
                                <h2>Launch a new thesis</h2>
                            </div>
                            {selectedGroup ? <span className="subtle-copy">Live in {selectedGroup.name}</span> : null}
                        </div>
                        <form onSubmit={(event) => void onCreateMarket(event)} className="create-market-grid">
                            <select
                                value={targetUserId}
                                onChange={(event) => setTargetUserId(event.target.value)}
                                required
                            >
                                <option value="">Choose who the market is about</option>
                                <option value={GENERAL_MARKET_VALUE}>General</option>
                                {selectedGroup?.members
                                    .filter((member) => member.id !== profile.user.id)
                                    .map((member) => (
                                        <option key={member.id} value={member.id}>
                                            {member.displayName}
                                        </option>
                                    ))}
                            </select>
                            <input
                                value={question}
                                onChange={(event) => setQuestion(event.target.value)}
                                placeholder="Will Alex announce the move before Labor Day?"
                                required
                            />
                            <textarea
                                rows={4}
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                placeholder="Settlement notes, timeline, edge cases"
                            />
                            <input
                                type="datetime-local"
                                value={closesAt}
                                onChange={(event) => setClosesAt(event.target.value)}
                                required
                            />
                            <button
                                className="primary-button"
                                type="submit"
                                disabled={!selectedGroupId || busyAction === "create-market"}
                            >
                                Publish market
                            </button>
                        </form>
                    </article>

                    <section className="market-board">
                        <div className="panel-heading board-heading">
                            <div>
                                <p className="kicker">Market board</p>
                                <h2>{selectedGroup?.name ?? "Choose a group"}</h2>
                            </div>
                            <span className="subtle-copy">
                                General markets are visible to everyone. Person-specific markets stay hidden from the subject.
                            </span>
                        </div>

                        {markets.length === 0 ? (
                            <article className="empty-panel">
                                <h3>No visible markets yet.</h3>
                                <p>Once a market targets someone else in this group, it will show up here with editable positions and automatic settlement.</p>
                            </article>
                        ) : (
                            <div className="market-grid">
                                {markets.map((market) => {
                                    const draft = tradeDrafts[market.id] ?? {
                                        side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" as const : "YES" as const,
                                        amount:
                                            market.userPosition.totalAmount > 0
                                                ? String(market.userPosition.totalAmount)
                                                : DEFAULT_TRADE_AMOUNT
                                    };

                                    return (
                                        <MarketCard
                                            key={market.id}
                                            market={market}
                                            profile={profile}
                                            selectedGroupRole={selectedGroup?.role}
                                            busyAction={busyAction}
                                            draft={draft}
                                            onUpdateTradeDraft={onUpdateTradeDraft}
                                            onSavePosition={onSavePosition}
                                            onConfirmPosition={onConfirmPosition}
                                            onRejectPosition={onRejectPosition}
                                            onResolveMarket={onResolve}
                                            onDeleteMarket={onDeleteMarket}
                                            onMarkPayoutSent={onMarkPayoutSent}
                                            onRespondToPayout={onRespondToPayout}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </section>
            </section>
        </main>
    );
}
