import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { addGroupBalance, confirmPosition, createGroupWithBalance, createMarket, deleteMarket, getCurrentUser, getMarkets, joinGroupWithBalance, rejectPosition, resolveMarket, upsertPosition } from "./lib/api";
const DEFAULT_TRADE_AMOUNT = "25";
function tomorrowAtNoon() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
    return date.toISOString().slice(0, 16);
}
function formatMoney(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(amount);
}
export default function App() {
    const { isAuthenticated, isLoading, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();
    const [token, setToken] = useState("");
    const [profile, setProfile] = useState(null);
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [markets, setMarkets] = useState([]);
    const [tradeDrafts, setTradeDrafts] = useState({});
    const [groupName, setGroupName] = useState("");
    const [groupStartingBalance, setGroupStartingBalance] = useState("500");
    const [joinCode, setJoinCode] = useState("");
    const [joinStartingBalance, setJoinStartingBalance] = useState("500");
    const [topUpAmount, setTopUpAmount] = useState("100");
    const [question, setQuestion] = useState("");
    const [description, setDescription] = useState("");
    const [targetUserId, setTargetUserId] = useState("");
    const [closesAt, setClosesAt] = useState(tomorrowAtNoon());
    const [statusMessage, setStatusMessage] = useState("Sign in to launch your prediction desk.");
    const [error, setError] = useState("");
    const [busyAction, setBusyAction] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const selectedGroup = useMemo(() => profile?.groups.find((group) => group.id === selectedGroupId) ?? null, [profile, selectedGroupId]);
    const visibleMembers = useMemo(() => [...(selectedGroup?.members ?? [])].sort((left, right) => right.balance - left.balance), [selectedGroup]);
    async function refreshProfile(accessToken) {
        const nextProfile = await getCurrentUser(accessToken);
        setProfile(nextProfile);
        return nextProfile;
    }
    async function refreshMarkets(accessToken, groupId) {
        const nextMarkets = await getMarkets(accessToken, groupId);
        setMarkets(nextMarkets);
        setTradeDrafts((currentDrafts) => {
            const nextDrafts = { ...currentDrafts };
            for (const market of nextMarkets) {
                if (!nextDrafts[market.id]) {
                    nextDrafts[market.id] = {
                        side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
                        amount: market.userPosition.totalAmount > 0
                            ? String(market.userPosition.totalAmount)
                            : DEFAULT_TRADE_AMOUNT
                    };
                }
            }
            return nextDrafts;
        });
    }
    async function refreshWorkspace(accessToken, groupId) {
        await Promise.all([refreshProfile(accessToken), refreshMarkets(accessToken, groupId)]);
    }
    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }
        let active = true;
        void (async () => {
            try {
                const accessToken = await getAccessTokenSilently();
                if (!active) {
                    return;
                }
                setToken(accessToken);
                const nextProfile = await refreshProfile(accessToken);
                const initialGroupId = nextProfile.groups[0]?.id ?? "";
                setSelectedGroupId(initialGroupId);
                if (initialGroupId) {
                    await refreshMarkets(accessToken, initialGroupId);
                }
                setStatusMessage("Desk synced. Balances, markets, and payouts are current.");
            }
            catch (requestError) {
                if (!active) {
                    return;
                }
                setError(requestError instanceof Error ? requestError.message : "Failed to load app data.");
            }
        })();
        return () => {
            active = false;
        };
    }, [getAccessTokenSilently, isAuthenticated]);
    useEffect(() => {
        if (!token || !selectedGroupId) {
            return;
        }
        void refreshMarkets(token, selectedGroupId).catch((requestError) => {
            setError(requestError instanceof Error ? requestError.message : "Failed to load markets.");
        });
    }, [selectedGroupId, token]);
    function updateTradeDraft(marketId, patch) {
        setTradeDrafts((currentDrafts) => ({
            ...currentDrafts,
            [marketId]: {
                side: currentDrafts[marketId]?.side ?? "YES",
                amount: currentDrafts[marketId]?.amount ?? DEFAULT_TRADE_AMOUNT,
                ...patch
            }
        }));
    }
    async function handleCreateGroup(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-group");
        try {
            const group = await createGroupWithBalance(token, {
                name: groupName,
                startingBalance: Number(groupStartingBalance)
            });
            setSelectedGroupId(group.id);
            setGroupName("");
            setGroupStartingBalance("500");
            await refreshWorkspace(token, group.id);
            setStatusMessage(`Created ${group.name} with your opening bankroll.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to create group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleJoinGroup(event) {
        event.preventDefault();
        setError("");
        setBusyAction("join-group");
        try {
            const response = await joinGroupWithBalance(token, {
                joinCode,
                startingBalance: Number(joinStartingBalance)
            });
            setSelectedGroupId(response.groupId);
            setJoinCode("");
            setJoinStartingBalance("500");
            await refreshWorkspace(token, response.groupId);
            setStatusMessage("Joined the group and funded your starting balance.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleAddFunds(event) {
        event.preventDefault();
        if (!selectedGroupId) {
            return;
        }
        setError("");
        setBusyAction("top-up");
        try {
            await addGroupBalance(token, selectedGroupId, Number(topUpAmount));
            await refreshProfile(token);
            setTopUpAmount("100");
            setStatusMessage("Balance updated.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to add balance.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleCreateMarket(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-market");
        try {
            await createMarket(token, {
                groupId: selectedGroupId,
                targetUserId,
                question,
                description,
                closesAt: new Date(closesAt).toISOString()
            });
            await refreshMarkets(token, selectedGroupId);
            setQuestion("");
            setDescription("");
            setTargetUserId("");
            setClosesAt(tomorrowAtNoon());
            setStatusMessage("Market published.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to create market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleSavePosition(marketId) {
        const draft = tradeDrafts[marketId] ?? { side: "YES", amount: DEFAULT_TRADE_AMOUNT };
        setError("");
        setBusyAction(`position-${marketId}`);
        try {
            const updatedMarket = await upsertPosition(token, marketId, {
                side: draft.side,
                amount: Number(draft.amount || "0")
            });
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(Number(draft.amount || "0") > 0
                ? `Position submitted. Venmo ${formatMoney(Number(draft.amount || "0"))} to ${updatedMarket.venmoRecipient.displayName}, then wait for creator confirmation.`
                : "Position removed.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to save position.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleConfirmPosition(marketId, positionId) {
        setError("");
        setBusyAction(`confirm-${positionId}`);
        try {
            await confirmPosition(token, marketId, positionId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Payment confirmed. The position is now live on the market.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to confirm payment.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRejectPosition(marketId, positionId) {
        setError("");
        setBusyAction(`reject-${positionId}`);
        try {
            await rejectPosition(token, marketId, positionId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Pending position rejected and funds returned.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to reject payment.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleResolve(marketId, resolution) {
        setError("");
        setBusyAction(`resolve-${marketId}`);
        try {
            await resolveMarket(token, marketId, resolution);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Market resolved and balances settled.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to resolve market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleDeleteMarket(marketId) {
        setError("");
        setBusyAction(`delete-${marketId}`);
        try {
            await deleteMarket(token, marketId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Market removed and all positions refunded.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to remove market.");
        }
        finally {
            setBusyAction("");
        }
    }
    if (isLoading) {
        return _jsx("main", { className: "shell", children: _jsx("section", { className: "loading-panel", children: "Loading authentication..." }) });
    }
    if (!isAuthenticated) {
        return (_jsx("main", { className: "shell landing-shell", children: _jsxs("section", { className: "landing-hero", children: [_jsxs("div", { className: "hero-copy", children: [_jsx("p", { className: "kicker", children: "Family Prediction Market" }), _jsx("h1", { children: "Private forecasting with sharper stakes and cleaner secrets." }), _jsx("p", { className: "hero-lede", children: "Spin up hidden markets, manage family bankrolls, and settle results automatically in a dashboard that feels more like a modern trading desk than a school project." }), _jsxs("div", { className: "hero-actions", children: [_jsx("button", { className: "primary-button", onClick: () => void loginWithRedirect(), children: "Enter the market" }), _jsx("div", { className: "hero-note", children: "Hidden from the subject, visible to the family, settled by real balances." })] })] }), _jsxs("div", { className: "hero-preview", children: [_jsxs("div", { className: "preview-card", children: [_jsx("span", { className: "preview-label", children: "Live signal" }), _jsx("strong", { children: "72% YES" }), _jsx("p", { children: "Will Jordan finally announce the move before July?" })] }), _jsxs("div", { className: "preview-card", children: [_jsx("span", { className: "preview-label", children: "Balance engine" }), _jsx("strong", { children: formatMoney(1240) }), _jsx("p", { children: "Track available cash, committed stakes, and automatic winner payouts." })] })] })] }) }));
    }
    return (_jsxs("main", { className: "shell app-shell", children: [_jsxs("section", { className: "dashboard-hero", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Trading desk" }), _jsx("h1", { children: user?.name ?? profile?.user.displayName ?? "Family member" }), _jsx("p", { className: "hero-lede", children: "Build private calls, shift bankroll between positions, and settle the whole market without spreadsheets." })] }), _jsxs("div", { className: "hero-meta", children: [_jsxs("div", { className: "metric-panel", children: [_jsx("span", { className: "metric-label", children: "Available balance" }), _jsx("strong", { children: formatMoney(selectedGroup?.balance ?? 0) }), _jsx("small", { children: selectedGroup?.name ?? "Choose a family group" })] }), _jsxs("div", { className: "hero-controls", children: [_jsx("button", { className: "secondary-button", type: "button", onClick: () => setSettingsOpen((current) => !current), children: settingsOpen ? "Close settings" : "Settings" }), _jsx("button", { className: "ghost-button", onClick: () => logout({
                                            logoutParams: {
                                                returnTo: window.location.origin
                                            }
                                        }), children: "Log out" })] })] })] }), _jsxs("section", { className: "status-banner", children: [_jsx("span", { children: statusMessage }), error ? _jsx("strong", { children: error }) : null] }), _jsxs("section", { className: "dashboard-grid", children: [_jsxs("aside", { className: "sidebar-stack", children: [_jsxs("article", { className: "panel family-strip", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Current family" }), _jsx("h2", { children: selectedGroup?.name ?? "Choose a family group" })] }), _jsx("span", { className: "subtle-copy", children: selectedGroup ? `Join code ${selectedGroup.joinCode}` : "Pick a group in settings" })] }), _jsx("div", { className: "group-selector vertical", children: profile?.groups.map((group) => (_jsxs("button", { type: "button", className: selectedGroupId === group.id ? "group-pill active" : "group-pill", onClick: () => setSelectedGroupId(group.id), children: [_jsx("span", { children: group.name }), _jsx("strong", { children: formatMoney(group.balance) }), _jsx("small", { children: group.joinCode })] }, group.id))) }), _jsxs("div", { className: "family-strip-meta", children: [_jsxs("div", { className: "compact-metric", children: [_jsx("span", { className: "metric-label", children: "Members" }), _jsx("strong", { children: selectedGroup?.members.length ?? 0 })] }), _jsxs("div", { className: "compact-metric", children: [_jsx("span", { className: "metric-label", children: "Visible markets" }), _jsx("strong", { children: markets.length })] })] })] }), settingsOpen ? (_jsxs("article", { className: "panel settings-panel", children: [_jsx("div", { className: "panel-heading", children: _jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Settings" }), _jsx("h2", { children: "Groups and bankroll" })] }) }), _jsxs("div", { className: "settings-grid", children: [_jsxs("form", { onSubmit: handleAddFunds, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: "Add funds to the current group" }), _jsx("input", { type: "number", min: "1", value: topUpAmount, onChange: (event) => setTopUpAmount(event.target.value), placeholder: "Amount", required: true }), _jsx("button", { className: "secondary-button", type: "submit", disabled: !selectedGroupId || busyAction === "top-up", children: "Add to balance" })] }), _jsxs("form", { onSubmit: handleCreateGroup, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: "Create a new family group" }), _jsx("input", { value: groupName, onChange: (event) => setGroupName(event.target.value), placeholder: "The Parkers", required: true }), _jsx("input", { type: "number", min: "0", value: groupStartingBalance, onChange: (event) => setGroupStartingBalance(event.target.value), placeholder: "Opening balance", required: true }), _jsx("button", { className: "primary-button", type: "submit", disabled: busyAction === "create-group", children: "Create group" })] }), _jsxs("form", { onSubmit: handleJoinGroup, className: "form-stack compact-form", children: [_jsx("span", { className: "subtle-copy", children: "Join another family group" }), _jsx("input", { value: joinCode, onChange: (event) => setJoinCode(event.target.value.toUpperCase()), placeholder: "Join code", required: true }), _jsx("input", { type: "number", min: "0", value: joinStartingBalance, onChange: (event) => setJoinStartingBalance(event.target.value), placeholder: "Opening balance", required: true }), _jsx("button", { className: "ghost-button", type: "submit", disabled: busyAction === "join-group", children: "Join group" })] })] })] })) : null, _jsxs("article", { className: "panel", children: [_jsx("div", { className: "panel-heading", children: _jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Members" }), _jsx("h2", { children: "Bankroll leaderboard" })] }) }), _jsx("div", { className: "member-grid sidebar-members", children: visibleMembers.map((member) => (_jsxs("div", { className: "member-card", children: [_jsxs("div", { children: [_jsx("strong", { children: member.displayName }), _jsx("span", { children: member.role })] }), _jsx("strong", { children: formatMoney(member.balance) })] }, member.id))) })] })] }), _jsxs("section", { className: "main-stack", children: [_jsxs("article", { className: "panel create-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Hidden market" }), _jsx("h2", { children: "Launch a new thesis" })] }), selectedGroup ? _jsxs("span", { className: "subtle-copy", children: ["Live in ", selectedGroup.name] }) : null] }), _jsxs("form", { onSubmit: handleCreateMarket, className: "create-market-grid", children: [_jsxs("select", { value: targetUserId, onChange: (event) => setTargetUserId(event.target.value), required: true, children: [_jsx("option", { value: "", children: "Choose who the market is about" }), selectedGroup?.members
                                                        .filter((member) => member.id !== profile?.user.id)
                                                        .map((member) => (_jsx("option", { value: member.id, children: member.displayName }, member.id)))] }), _jsx("input", { value: question, onChange: (event) => setQuestion(event.target.value), placeholder: "Will Alex announce the move before Labor Day?", required: true }), _jsx("textarea", { rows: 4, value: description, onChange: (event) => setDescription(event.target.value), placeholder: "Settlement notes, timeline, edge cases" }), _jsx("input", { type: "datetime-local", value: closesAt, onChange: (event) => setClosesAt(event.target.value), required: true }), _jsx("button", { className: "primary-button", type: "submit", disabled: !selectedGroupId || busyAction === "create-market", children: "Publish market" })] })] }), _jsxs("section", { className: "market-board", children: [_jsxs("div", { className: "panel-heading board-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Market board" }), _jsx("h2", { children: selectedGroup?.name ?? "Choose a group" })] }), _jsx("span", { className: "subtle-copy", children: "Hidden markets stay invisible to the person they target." })] }), markets.length === 0 ? (_jsxs("article", { className: "empty-panel", children: [_jsx("h3", { children: "No visible markets yet." }), _jsx("p", { children: "Once a market targets someone else in this group, it will show up here with editable positions and automatic settlement." })] })) : (_jsx("div", { className: "market-grid", children: markets.map((market) => {
                                            const draft = tradeDrafts[market.id] ?? {
                                                side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
                                                amount: market.userPosition.totalAmount > 0
                                                    ? String(market.userPosition.totalAmount)
                                                    : DEFAULT_TRADE_AMOUNT
                                            };
                                            const canRemove = market.createdBy.id === profile?.user.id || selectedGroup?.role === "ADMIN";
                                            return (_jsxs("article", { className: "market-panel", children: [_jsxs("div", { className: "market-topline", children: [_jsxs("div", { children: [_jsxs("p", { className: "kicker", children: ["About ", market.targetUser.displayName] }), _jsx("h3", { children: market.question })] }), _jsx("span", { className: `status-pill ${market.status.toLowerCase()}`, children: market.status })] }), market.description ? _jsx("p", { className: "market-copy", children: market.description }) : null, _jsxs("div", { className: "market-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "YES" }), _jsxs("strong", { children: [Math.round(market.summary.yesPrice * 100), "%"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Total pot" }), _jsx("strong", { children: formatMoney(market.summary.totalVolume) })] }), _jsxs("div", { children: [_jsx("span", { children: "Live stake" }), _jsx("strong", { children: formatMoney(market.userPosition.totalAmount) })] }), _jsxs("div", { children: [_jsx("span", { children: "Closes" }), _jsx("strong", { children: new Date(market.closesAt).toLocaleString() })] })] }), _jsxs("div", { className: "market-rail", children: [_jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Creator" }), _jsx("strong", { children: market.createdBy.displayName })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Leading side" }), _jsx("strong", { children: market.summary.leadingSide })] }), _jsxs("div", { className: "market-rail-card", children: [_jsx("span", { children: "Payout to you" }), _jsx("strong", { children: formatMoney(market.userPayout) })] })] }), _jsxs("div", { className: "trade-box", children: [_jsxs("div", { className: "trade-toggle", children: [_jsx("button", { type: "button", className: draft.side === "YES" ? "toggle-button active-yes" : "toggle-button", onClick: () => updateTradeDraft(market.id, { side: "YES" }), children: "YES" }), _jsx("button", { type: "button", className: draft.side === "NO" ? "toggle-button active-no" : "toggle-button", onClick: () => updateTradeDraft(market.id, { side: "NO" }), children: "NO" })] }), _jsx("input", { type: "number", min: "0", value: draft.amount, onChange: (event) => updateTradeDraft(market.id, { amount: event.target.value }), placeholder: "Stake amount" }), _jsx("button", { className: "primary-button", type: "button", disabled: busyAction === `position-${market.id}` || market.status !== "OPEN", onClick: () => void handleSavePosition(market.id), children: market.userPosition.totalAmount > 0 ? "Update position" : "Place position" }), market.status === "OPEN" ? (_jsxs("p", { className: "trade-note", children: ["After saving, Venmo ", formatMoney(Number(draft.amount || "0")), " to ", market.venmoRecipient.displayName, " so the market creator can escrow the pool."] })) : null, market.userPendingPosition.totalAmount > 0 ? (_jsxs("p", { className: "trade-note pending-note", children: ["Pending confirmation: ", formatMoney(market.userPendingPosition.totalAmount), ". This will not affect the market until ", market.venmoRecipient.displayName, " confirms receipt."] })) : null] }), market.pendingConfirmations.length > 0 && market.createdBy.id === profile?.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Pending receipts" }), _jsx("strong", { children: "Confirm Venmo before the stake goes live" })] }), _jsx("div", { className: "settlement-list", children: market.pendingConfirmations.map((pending) => (_jsxs("div", { className: "settlement-row pending-row", children: [_jsxs("div", { children: [_jsx("span", { children: pending.displayName }), _jsxs("small", { children: [pending.side, " for ", formatMoney(pending.amount)] })] }), _jsxs("div", { className: "market-footer-actions", children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `confirm-${pending.positionId}`, onClick: () => void handleConfirmPosition(market.id, pending.positionId), children: "Confirm payment" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `reject-${pending.positionId}`, onClick: () => void handleRejectPosition(market.id, pending.positionId), children: "Reject" })] })] }, pending.positionId))) })] })) : null, market.status === "RESOLVED" && market.createdBy.id === profile?.user.id ? (_jsxs("div", { className: "settlement-box", children: [_jsxs("div", { className: "settlement-heading", children: [_jsx("span", { className: "kicker", children: "Creator payout sheet" }), _jsx("strong", { children: "Send these payouts now" })] }), market.creatorPayouts.length === 0 ? (_jsx("p", { className: "subtle-copy", children: "Nobody backed the winning side. Refund bettors if you handled this market off-platform." })) : (_jsx("div", { className: "settlement-list", children: market.creatorPayouts.map((payout) => (_jsxs("div", { className: "settlement-row", children: [_jsx("span", { children: payout.displayName }), _jsx("strong", { children: formatMoney(payout.amount) })] }, payout.userId))) }))] })) : null, _jsxs("div", { className: "market-footer", children: [_jsxs("span", { className: "subtle-copy", children: ["Current split: ", formatMoney(market.userPosition.yesAmount), " YES / ", formatMoney(market.userPosition.noAmount), " NO"] }), _jsxs("div", { className: "market-footer-actions", children: [canRemove ? (_jsx("button", { className: "ghost-button", type: "button", disabled: busyAction === `delete-${market.id}` || market.status === "RESOLVED", onClick: () => void handleDeleteMarket(market.id), children: "Remove market" })) : null, selectedGroup?.role === "ADMIN" && market.status !== "RESOLVED" ? (_jsxs(_Fragment, { children: [_jsx("button", { className: "ghost-button yes-outline", type: "button", disabled: busyAction === `resolve-${market.id}`, onClick: () => void handleResolve(market.id, true), children: "Resolve YES" }), _jsx("button", { className: "ghost-button no-outline", type: "button", disabled: busyAction === `resolve-${market.id}`, onClick: () => void handleResolve(market.id, false), children: "Resolve NO" })] })) : null] })] })] }, market.id));
                                        }) }))] })] })] })] }));
}
