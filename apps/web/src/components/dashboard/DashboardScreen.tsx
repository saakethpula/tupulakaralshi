import { useEffect, useState, type FormEvent } from "react";
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
    outcomeLabels: string[];
    setOutcomeLabels: (value: string[] | ((current: string[]) => string[])) => void;
    closesAt: string;
    setClosesAt: (value: string) => void;
    groupName: string;
    setGroupName: (value: string) => void;
    joinCode: string;
    setJoinCode: (value: string) => void;
    referralJoinCode: string;
    venmoHandle: string;
    setVenmoHandle: (value: string) => void;
    minBet: string;
    setMinBet: (value: string) => void;
    maxBet: string;
    setMaxBet: (value: string) => void;
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
    onSaveBetLimits: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onCreateMarket: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onUpdateTradeDraft: (marketId: string, patch: Partial<TradeDraft>) => void;
    onSavePosition: (marketId: string) => Promise<void>;
    onResolve: (marketId: string, outcomeId: string) => Promise<void>;
    onConfirmMarketResolution: (marketId: string) => Promise<void>;
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
    outcomeLabels,
    setOutcomeLabels,
    closesAt,
    setClosesAt,
    groupName,
    setGroupName,
    joinCode,
    setJoinCode,
    referralJoinCode,
    venmoHandle,
    setVenmoHandle,
    minBet,
    setMinBet,
    maxBet,
    setMaxBet,
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
    onSaveBetLimits,
    onCreateMarket,
    onUpdateTradeDraft,
    onSavePosition,
    onResolve,
    onConfirmMarketResolution,
    onDeleteMarket,
    onMarkPayoutSent,
    onRespondToPayout
}: DashboardScreenProps) {
    const [activeMarketIndex, setActiveMarketIndex] = useState(0);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const [createMarketOpen, setCreateMarketOpen] = useState(false);
    const activeMarket = markets[activeMarketIndex] ?? markets[0];

    useEffect(() => {
        setActiveMarketIndex((current) => {
            if (markets.length === 0) {
                return 0;
            }

            return Math.min(current, markets.length - 1);
        });
    }, [markets.length]);

    function goToMarket(offset: number) {
        setActiveMarketIndex((current) => {
            if (markets.length === 0) {
                return 0;
            }

            return (current + offset + markets.length) % markets.length;
        });
    }

    function handleMarketTouchEnd(clientX: number) {
        if (touchStartX === null) {
            return;
        }

        const deltaX = clientX - touchStartX;
        setTouchStartX(null);

        if (Math.abs(deltaX) < 48 || markets.length < 2) {
            return;
        }

        goToMarket(deltaX < 0 ? 1 : -1);
    }

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
                minBet={minBet}
                setMinBet={setMinBet}
                maxBet={maxBet}
                setMaxBet={setMaxBet}
                onSaveBetLimits={onSaveBetLimits}
            />

            {createMarketOpen ? (
                <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="create-market-title">
                    <button
                        className="settings-backdrop"
                        type="button"
                        aria-label="Close create market"
                        onClick={() => setCreateMarketOpen(false)}
                    />
                    <section className="settings-modal create-market-modal">
                        <div className="panel-heading settings-modal-heading">
                            <div>
                                <p className="kicker">Create market</p>
                                <h2 id="create-market-title">Launch a new thesis</h2>
                            </div>
                            <button className="toolbar-button toolbar-button-secondary" type="button" onClick={() => setCreateMarketOpen(false)}>
                                Close
                            </button>
                        </div>
                        {selectedGroup ? <p className="subtle-copy modal-context">Live in {selectedGroup.name}</p> : null}
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
                            <div className="form-stack outcome-editor">
                                <span className="subtle-copy">Outcomes</span>
                                {outcomeLabels.map((label, index) => (
                                    <input
                                        key={index}
                                        value={label}
                                        onChange={(event) => setOutcomeLabels((current) => current.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))}
                                        placeholder={`Outcome ${index + 1}`}
                                        required={index < 2}
                                    />
                                ))}
                                <div className="market-footer-actions">
                                    {outcomeLabels.length < 5 ? (
                                        <button
                                            className="ghost-button"
                                            type="button"
                                            onClick={() => setOutcomeLabels((current) => [...current, ""])}
                                        >
                                            Add outcome
                                        </button>
                                    ) : null}
                                    {outcomeLabels.length > 2 ? (
                                        <button
                                            className="ghost-button"
                                            type="button"
                                            onClick={() => setOutcomeLabels((current) => current.slice(0, -1))}
                                        >
                                            Remove outcome
                                        </button>
                                    ) : null}
                                </div>
                            </div>
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
                    </section>
                </div>
            ) : null}

            <section className="dashboard-grid">
                <section className="main-stack">
                    <section className="market-board">
                        <div className="panel-heading board-heading">
                            <div>
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
                        ) : activeMarket ? (
                            <div className="market-carousel">
                                <div className="market-carousel-toolbar">
                                    <button
                                        className="ghost-button"
                                        type="button"
                                        disabled={markets.length < 2}
                                        onClick={() => goToMarket(-1)}
                                    >
                                        Previous
                                    </button>
                                    <span className="subtle-copy">
                                        {activeMarketIndex + 1} of {markets.length}
                                    </span>
                                    <button
                                        className="ghost-button"
                                        type="button"
                                        disabled={markets.length < 2}
                                        onClick={() => goToMarket(1)}
                                    >
                                        Next
                                    </button>
                                </div>

                                <div
                                    className="market-slide"
                                    onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
                                    onTouchEnd={(event) => handleMarketTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
                                >
                                    <MarketCard
                                        key={activeMarket.id}
                                        market={activeMarket}
                                        profile={profile}
                                        selectedGroupRole={selectedGroup?.role}
                                        maxBet={selectedGroup?.maxBet ?? 15}
                                        busyAction={busyAction}
                                        draft={tradeDrafts[activeMarket.id] ?? {
                                            outcomeId: activeMarket.userPosition.outcomeAmounts.find((outcome) => outcome.amount > 0)?.id ?? activeMarket.outcomes[0]?.id ?? "",
                                            side: "YES" as const,
                                            amount:
                                                activeMarket.userPosition.totalAmount > 0
                                                    ? String(activeMarket.userPosition.totalAmount)
                                                    : DEFAULT_TRADE_AMOUNT
                                        }}
                                        onUpdateTradeDraft={onUpdateTradeDraft}
                                        onSavePosition={onSavePosition}
                                        onResolveMarket={onResolve}
                                        onConfirmMarketResolution={onConfirmMarketResolution}
                                        onDeleteMarket={onDeleteMarket}
                                        onMarkPayoutSent={onMarkPayoutSent}
                                        onRespondToPayout={onRespondToPayout}
                                    />
                                </div>

                                {markets.length > 1 ? (
                                    <div className="market-carousel-dots" aria-label="Choose market">
                                        {markets.map((market, index) => (
                                            <button
                                                key={market.id}
                                                className={index === activeMarketIndex ? "carousel-dot active" : "carousel-dot"}
                                                type="button"
                                                aria-label={`Show market ${index + 1}`}
                                                onClick={() => setActiveMarketIndex(index)}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </section>
                </section>

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
                        <button
                            className="primary-button create-market-trigger"
                            type="button"
                            disabled={!selectedGroupId}
                            onClick={() => setCreateMarketOpen(true)}
                        >
                            Create market
                        </button>
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
            </section>
        </main>
    );
}
