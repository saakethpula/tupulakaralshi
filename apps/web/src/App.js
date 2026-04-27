import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { confirmMarketResolution, confirmPosition, createGroup, createMarket, deleteGroup, deleteMarket, getCurrentUser, getMarkets, getRealtimeWebSocketUrl, joinGroup, markPayoutSent, removeGroupMember, rejectPosition, respondToPayout, resolveMarket, updateGroupBetLimits, updateTutorialCompletion, updateVenmoHandle, upsertPosition } from "./lib/api";
import { DashboardScreen } from "./components/dashboard/DashboardScreen";
import { LandingScreen } from "./components/LandingScreen";
import { OnboardingScreen } from "./components/onboarding/OnboardingScreen";
import { DEFAULT_TRADE_AMOUNT, GENERAL_MARKET_VALUE, FALLBACK_REFRESH_INTERVAL_MS, SOCKET_RECONNECT_MAX_DELAY_MS, SOCKET_RECONNECT_MIN_DELAY_MS } from "./constants/app";
import { formatMoney, tomorrowAtNoon } from "./utils/format";
import { buildGroupInviteUrl, clearReferralJoinCodeFromUrl, clearSavedReferralJoinCode, getReferralJoinCodeFromUrl, getSavedReferralJoinCode, saveReferralJoinCodeFromUrl } from "./utils/groups";
import { getTutorialPrompt, resetTutorialState } from "./utils/tutorial";
import { getVenmoUrl, normalizeVenmoHandle } from "./utils/venmo";
const THEME_PREFERENCE_STORAGE_KEY = "family-market-theme-preference";
function getSystemTheme() {
    if (typeof window === "undefined") {
        return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function getInitialThemePreference() {
    if (typeof window === "undefined") {
        return "system";
    }
    const storedPreference = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (storedPreference === "light" || storedPreference === "dark" || storedPreference === "system") {
        return storedPreference;
    }
    return "system";
}
export default function App() {
    const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
    const [token, setToken] = useState("");
    const [profile, setProfile] = useState(null);
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [markets, setMarkets] = useState([]);
    const [tradeDrafts, setTradeDrafts] = useState({});
    const [groupName, setGroupName] = useState("");
    const [joinCode, setJoinCode] = useState("");
    const [referralJoinCode, setReferralJoinCode] = useState(() => getReferralJoinCodeFromUrl() || getSavedReferralJoinCode());
    const [skipGroupSetupStep, setSkipGroupSetupStep] = useState(false);
    const [hasAttemptedReferralJoin, setHasAttemptedReferralJoin] = useState(false);
    const [venmoHandle, setVenmoHandle] = useState("");
    const [question, setQuestion] = useState("");
    const [description, setDescription] = useState("");
    const [targetUserId, setTargetUserId] = useState("");
    const [outcomeLabels, setOutcomeLabels] = useState(["YES", "NO"]);
    const [minBet, setMinBet] = useState("1");
    const [maxBet, setMaxBet] = useState("15");
    const [requireVenmoForBets, setRequireVenmoForBets] = useState(false);
    const [closesAt, setClosesAt] = useState(tomorrowAtNoon());
    const [statusMessage, setStatusMessage] = useState("Sign in to launch your prediction desk.");
    const [error, setError] = useState("");
    const [busyAction, setBusyAction] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [familyManagerOpen, setFamilyManagerOpen] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [onboardingStep, setOnboardingStep] = useState(0);
    const [groupSetupMode, setGroupSetupMode] = useState("join");
    const [tutorialDraft, setTutorialDraft] = useState({ outcomeId: "YES", side: "YES", amount: DEFAULT_TRADE_AMOUNT });
    const [tutorialPracticeStep, setTutorialPracticeStep] = useState("pick-side");
    const [tutorialHoverTarget, setTutorialHoverTarget] = useState(null);
    const [tutorialBetPlaced, setTutorialBetPlaced] = useState(false);
    const [themePreference, setThemePreference] = useState(() => getInitialThemePreference());
    const [resolvedTheme, setResolvedTheme] = useState(() => {
        const initialPreference = getInitialThemePreference();
        return initialPreference === "system" ? getSystemTheme() : initialPreference;
    });
    const selectedGroupIdRef = useRef(selectedGroupId);
    const liveRefreshInFlightRef = useRef(false);
    const selectedGroup = useMemo(() => profile?.groups.find((group) => group.id === selectedGroupId) ?? null, [profile, selectedGroupId]);
    const visibleMembers = useMemo(() => [...(selectedGroup?.members ?? [])].sort((left, right) => right.balance - left.balance), [selectedGroup]);
    const needsVenmoHandle = !profile?.user.venmoHandle;
    const needsFirstGroup = (profile?.groups.length ?? 0) === 0;
    const onboardingReady = !needsVenmoHandle && !needsFirstGroup;
    const canStartPractice = onboardingReady;
    const tutorialAmountNumber = Number(tutorialDraft.amount || "0");
    const tutorialPrompt = getTutorialPrompt(tutorialHoverTarget, tutorialPracticeStep);
    const tutorialVenmoUrl = getVenmoUrl("saakethp");
    const selectedGroupInviteUrl = selectedGroup ? buildGroupInviteUrl(selectedGroup.joinCode) : "";
    useEffect(() => {
        selectedGroupIdRef.current = selectedGroupId;
    }, [selectedGroupId]);
    useEffect(() => {
        window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference);
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const applyResolvedTheme = () => {
            setResolvedTheme(themePreference === "system" ? (mediaQuery.matches ? "dark" : "light") : themePreference);
        };
        applyResolvedTheme();
        if (themePreference !== "system") {
            return;
        }
        mediaQuery.addEventListener("change", applyResolvedTheme);
        return () => {
            mediaQuery.removeEventListener("change", applyResolvedTheme);
        };
    }, [themePreference]);
    useEffect(() => {
        document.documentElement.dataset.theme = resolvedTheme;
    }, [resolvedTheme]);
    useEffect(() => {
        if (isLoading) {
            return;
        }
        const nextReferralJoinCode = getReferralJoinCodeFromUrl() || getSavedReferralJoinCode();
        if (nextReferralJoinCode && nextReferralJoinCode !== referralJoinCode) {
            setReferralJoinCode(nextReferralJoinCode);
            setHasAttemptedReferralJoin(false);
        }
    }, [isLoading, isAuthenticated, referralJoinCode]);
    async function refreshProfile(accessToken) {
        const nextProfile = await getCurrentUser(accessToken);
        setProfile(nextProfile);
        setVenmoHandle(nextProfile.user.venmoHandle ?? "");
        const activeGroup = nextProfile.groups.find((group) => group.id === selectedGroupIdRef.current) ?? nextProfile.groups[0];
        if (activeGroup) {
            setMinBet(String(activeGroup.minBet));
            setMaxBet(String(activeGroup.maxBet));
            setRequireVenmoForBets(activeGroup.requireVenmoForBets);
        }
        return nextProfile;
    }
    async function refreshMarkets(accessToken, groupId) {
        const nextMarkets = await getMarkets(accessToken, groupId);
        setMarkets(nextMarkets);
        setTradeDrafts((currentDrafts) => {
            const nextDrafts = { ...currentDrafts };
            for (const market of nextMarkets) {
                if (!nextDrafts[market.id]) {
                    const firstOutcome = market.outcomes[0];
                    const leadingUserOutcome = market.userPosition.outcomeAmounts
                        .filter((outcome) => outcome.amount > 0)
                        .sort((left, right) => right.amount - left.amount)[0];
                    nextDrafts[market.id] = {
                        outcomeId: leadingUserOutcome?.id ?? firstOutcome?.id ?? "",
                        side: leadingUserOutcome?.label === "NO" ? "NO" : "YES",
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
    async function refreshLiveWorkspace(accessToken, groupIds) {
        if (liveRefreshInFlightRef.current || document.visibilityState === "hidden") {
            return;
        }
        liveRefreshInFlightRef.current = true;
        try {
            const nextProfile = await refreshProfile(accessToken);
            let activeGroupId = selectedGroupIdRef.current;
            if (!activeGroupId && nextProfile.groups[0]?.id) {
                activeGroupId = nextProfile.groups[0].id;
                setSelectedGroupId(activeGroupId);
            }
            else if (activeGroupId && !nextProfile.groups.some((group) => group.id === activeGroupId)) {
                activeGroupId = nextProfile.groups[0]?.id ?? "";
                setSelectedGroupId(activeGroupId);
            }
            if (activeGroupId) {
                const shouldRefreshMarkets = !groupIds || groupIds.length === 0 || groupIds.includes(activeGroupId);
                if (shouldRefreshMarkets) {
                    await refreshMarkets(accessToken, activeGroupId);
                }
            }
            else {
                setMarkets([]);
            }
            setError("");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to refresh live data.");
        }
        finally {
            liveRefreshInFlightRef.current = false;
        }
    }
    async function copyInviteLink(joinCodeToShare) {
        const inviteUrl = buildGroupInviteUrl(joinCodeToShare);
        if (!inviteUrl) {
            return;
        }
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setStatusMessage("Invite link copied.");
            setError("");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to copy invite link.");
        }
    }
    function openFamilyManager() {
        setSettingsOpen(false);
        setFamilyManagerOpen(true);
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
    useEffect(() => {
        if (!token) {
            return;
        }
        let active = true;
        let socket = null;
        let reconnectTimerId = 0;
        let reconnectDelay = SOCKET_RECONNECT_MIN_DELAY_MS;
        const clearReconnectTimer = () => {
            if (reconnectTimerId) {
                window.clearTimeout(reconnectTimerId);
                reconnectTimerId = 0;
            }
        };
        const scheduleReconnect = () => {
            if (!active || reconnectTimerId) {
                return;
            }
            const nextDelay = reconnectDelay;
            reconnectDelay = Math.min(reconnectDelay * 2, SOCKET_RECONNECT_MAX_DELAY_MS);
            reconnectTimerId = window.setTimeout(() => {
                reconnectTimerId = 0;
                connect();
            }, nextDelay);
        };
        const connect = () => {
            if (!active) {
                return;
            }
            clearReconnectTimer();
            socket = new WebSocket(getRealtimeWebSocketUrl());
            socket.addEventListener("open", () => {
                reconnectDelay = SOCKET_RECONNECT_MIN_DELAY_MS;
                socket?.send(JSON.stringify({
                    type: "auth",
                    token
                }));
            });
            socket.addEventListener("message", (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type !== "workspace.invalidate") {
                        return;
                    }
                    void refreshLiveWorkspace(token, Array.isArray(message.groupIds) ? message.groupIds : undefined);
                }
                catch {
                    // Ignore malformed socket payloads and wait for the next valid event.
                }
            });
            socket.addEventListener("close", () => {
                socket = null;
                scheduleReconnect();
            });
            socket.addEventListener("error", () => {
                socket?.close();
            });
        };
        const fallbackIntervalId = window.setInterval(() => {
            if (document.visibilityState === "hidden") {
                return;
            }
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                void refreshLiveWorkspace(token);
            }
        }, FALLBACK_REFRESH_INTERVAL_MS);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void refreshLiveWorkspace(token);
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        connect();
        return () => {
            active = false;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearReconnectTimer();
            window.clearInterval(fallbackIntervalId);
            socket?.close();
        };
    }, [token]);
    useEffect(() => {
        if (!profile) {
            return;
        }
        if (!profile.user.hasCompletedTutorial) {
            setShowOnboarding(true);
            return;
        }
        setShowOnboarding(false);
    }, [profile]);
    useEffect(() => {
        if (!referralJoinCode) {
            return;
        }
        setJoinCode(referralJoinCode);
        setGroupSetupMode("join");
    }, [referralJoinCode]);
    useEffect(() => {
        if (!token || !profile || !referralJoinCode || hasAttemptedReferralJoin) {
            return;
        }
        const existingGroup = profile.groups.find((group) => group.joinCode === referralJoinCode);
        if (existingGroup) {
            setSelectedGroupId(existingGroup.id);
            setReferralJoinCode("");
            setSkipGroupSetupStep(true);
            clearSavedReferralJoinCode();
            clearReferralJoinCodeFromUrl();
            setOnboardingStep((current) => current === 2 ? 3 : current);
            setStatusMessage(`Invite link opened for ${existingGroup.name}.`);
            return;
        }
        setHasAttemptedReferralJoin(true);
        setBusyAction("join-group");
        setError("");
        void (async () => {
            try {
                const response = await joinGroup(token, referralJoinCode);
                setSelectedGroupId(response.groupId);
                setJoinCode("");
                setReferralJoinCode("");
                setSkipGroupSetupStep(true);
                clearSavedReferralJoinCode();
                clearReferralJoinCodeFromUrl();
                await refreshWorkspace(token, response.groupId);
                setOnboardingStep((current) => current === 2 ? 3 : current);
                setStatusMessage("Joined the group from the invite link.");
            }
            catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
            }
            finally {
                setBusyAction("");
            }
        })();
    }, [hasAttemptedReferralJoin, profile, referralJoinCode, token]);
    useEffect(() => {
        if (tutorialPracticeStep === "enter-amount" && tutorialAmountNumber > 0) {
            setTutorialPracticeStep("submit-bet");
        }
    }, [tutorialAmountNumber, tutorialPracticeStep]);
    function updateTradeDraft(marketId, patch) {
        setTradeDrafts((currentDrafts) => ({
            ...currentDrafts,
            [marketId]: {
                outcomeId: currentDrafts[marketId]?.outcomeId ?? "",
                side: currentDrafts[marketId]?.side ?? "YES",
                amount: currentDrafts[marketId]?.amount ?? DEFAULT_TRADE_AMOUNT,
                ...patch
            }
        }));
    }
    function handleTutorialSideChange(side) {
        setTutorialDraft((current) => ({
            ...current,
            side,
            outcomeId: side
        }));
        if (tutorialPracticeStep === "pick-side") {
            setTutorialPracticeStep("enter-amount");
        }
    }
    function handleTutorialAmountChange(amount) {
        setTutorialDraft((current) => ({
            ...current,
            amount
        }));
    }
    function handleTutorialPlaceBet() {
        if (tutorialAmountNumber <= 0) {
            return;
        }
        setTutorialBetPlaced(true);
        setTutorialPracticeStep("send-venmo");
    }
    function handleTutorialPaymentSent() {
        setTutorialPracticeStep("done");
    }
    async function handleTutorialCompletion() {
        setError("");
        setBusyAction("tutorial-complete");
        try {
            await updateTutorialCompletion(token, true);
            await refreshProfile(token);
            clearSavedReferralJoinCode();
            setSkipGroupSetupStep(false);
            setShowOnboarding(false);
            setStatusMessage("Setup complete. Your desk is ready.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to save tutorial progress.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRestartTutorial() {
        setError("");
        setBusyAction("tutorial-reset");
        try {
            await updateTutorialCompletion(token, false);
            await refreshProfile(token);
            const resetState = resetTutorialState();
            setOnboardingStep(resetState.onboardingStep);
            setTutorialDraft(resetState.tutorialDraft);
            setTutorialPracticeStep(resetState.tutorialPracticeStep);
            setTutorialBetPlaced(resetState.tutorialBetPlaced);
            setTutorialHoverTarget(null);
            setSkipGroupSetupStep(false);
            setSettingsOpen(false);
            setShowOnboarding(true);
            setStatusMessage("Tutorial restarted. Walk through the setup again whenever you're ready.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to restart tutorial.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleCreateGroup(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-group");
        try {
            const group = await createGroup(token, groupName);
            setSelectedGroupId(group.id);
            setGroupName("");
            setSkipGroupSetupStep(false);
            await refreshWorkspace(token, group.id);
            setOnboardingStep((current) => current === 2 ? 3 : current);
            setStatusMessage(`Created ${group.name}.`);
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
            const response = await joinGroup(token, joinCode);
            setSelectedGroupId(response.groupId);
            setJoinCode("");
            setReferralJoinCode("");
            setSkipGroupSetupStep(false);
            clearSavedReferralJoinCode();
            clearReferralJoinCodeFromUrl();
            await refreshWorkspace(token, response.groupId);
            setOnboardingStep((current) => current === 2 ? 3 : current);
            setStatusMessage("Joined the group.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRemoveGroupMember(groupId, memberId, memberName) {
        const confirmed = window.confirm(`Remove ${memberName} from this group?`);
        if (!confirmed) {
            return;
        }
        setError("");
        setBusyAction(`remove-member-${memberId}`);
        try {
            await removeGroupMember(token, groupId, memberId);
            await refreshWorkspace(token, groupId);
            setStatusMessage(`${memberName} was removed from the group.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to remove group member.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleDeleteGroup(groupId, groupNameToDelete) {
        const confirmed = window.confirm(`Delete ${groupNameToDelete}? This removes the group for everyone.`);
        if (!confirmed) {
            return;
        }
        setError("");
        setBusyAction(`delete-group-${groupId}`);
        try {
            await deleteGroup(token, groupId);
            const nextProfile = await refreshProfile(token);
            const nextSelectedGroupId = selectedGroupId === groupId ? nextProfile.groups[0]?.id ?? "" : selectedGroupId;
            setSelectedGroupId(nextSelectedGroupId);
            if (nextSelectedGroupId) {
                await refreshMarkets(token, nextSelectedGroupId);
            }
            else {
                setMarkets([]);
            }
            setSettingsOpen(false);
            setStatusMessage(`${groupNameToDelete} was deleted.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to delete group.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleSaveVenmoHandle(event) {
        event.preventDefault();
        setError("");
        setBusyAction("venmo");
        try {
            await updateVenmoHandle(token, venmoHandle);
            await refreshProfile(token);
            setOnboardingStep((current) => current === 1 ? (skipGroupSetupStep ? 3 : 2) : current);
            setStatusMessage(`Venmo handle saved as @${normalizeVenmoHandle(venmoHandle)}.`);
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to save Venmo handle.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleSaveBetLimits(event) {
        event.preventDefault();
        setError("");
        setBusyAction("bet-limits");
        try {
            await updateGroupBetLimits(token, selectedGroupId, Number(minBet || "0"), Number(maxBet || "0"), requireVenmoForBets);
            await refreshProfile(token);
            setStatusMessage(requireVenmoForBets ? "Bet limits updated. Venmo confirmation is required." : "Bet limits updated. Stakes now go live immediately.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to update bet limits.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleCreateMarket(event) {
        event.preventDefault();
        setError("");
        setBusyAction("create-market");
        const normalizedOutcomes = [...new Set(outcomeLabels.map((label) => label.trim()).filter(Boolean))];
        if (normalizedOutcomes.length < 2 || normalizedOutcomes.length > 5) {
            setError("Add between 2 and 5 unique outcomes.");
            setBusyAction("");
            return;
        }
        try {
            await createMarket(token, {
                groupId: selectedGroupId,
                targetUserId: targetUserId === GENERAL_MARKET_VALUE ? null : targetUserId,
                question,
                description,
                closesAt: new Date(closesAt).toISOString(),
                outcomes: normalizedOutcomes
            });
            await refreshMarkets(token, selectedGroupId);
            setQuestion("");
            setDescription("");
            setTargetUserId("");
            setOutcomeLabels(["YES", "NO"]);
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
        const market = markets.find((entry) => entry.id === marketId);
        const draft = tradeDrafts[marketId] ?? { outcomeId: market?.outcomes[0]?.id ?? "", side: "YES", amount: DEFAULT_TRADE_AMOUNT };
        const requestedAmount = Number(draft.amount || "0");
        const existingAmount = market
            ? market.userPosition.totalAmount + market.userPendingPosition.totalAmount
            : 0;
        const topUpAmount = Math.max(0, requestedAmount - existingAmount);
        setError("");
        setBusyAction(`position-${marketId}`);
        try {
            const updatedMarket = await upsertPosition(token, marketId, {
                outcomeId: draft.outcomeId,
                amount: requestedAmount
            });
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(topUpAmount > 0
                ? selectedGroup?.requireVenmoForBets
                    ? `Position submitted. Send ${formatMoney(topUpAmount)} using the Venmo link for ${updatedMarket.venmoRecipient.venmoHandle ? `@${normalizeVenmoHandle(updatedMarket.venmoRecipient.venmoHandle)}` : updatedMarket.venmoRecipient.displayName}, then wait for creator confirmation.`
                    : `Position is live. Optionally send ${formatMoney(topUpAmount)} using the Venmo link for ${updatedMarket.venmoRecipient.venmoHandle ? `@${normalizeVenmoHandle(updatedMarket.venmoRecipient.venmoHandle)}` : updatedMarket.venmoRecipient.displayName} so the market stays settled on good faith.`
                : "Enter a larger amount to add to this position.");
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
            setStatusMessage("Pending position rejected.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to reject payment.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleResolve(marketId, outcomeId) {
        setError("");
        setBusyAction(`resolve-${marketId}`);
        try {
            await resolveMarket(token, marketId, outcomeId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Resolution proposed. 30% of the group needs to confirm it before settlement runs.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to resolve market.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleConfirmMarketResolution(marketId) {
        setError("");
        setBusyAction(`resolution-confirm-${marketId}`);
        try {
            const updatedMarket = await confirmMarketResolution(token, marketId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(updatedMarket.status === "RESOLVED"
                ? "Resolution confirmed by enough group members. Settlement is now final."
                : "Resolution confirmation recorded.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to confirm resolution.");
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
    async function handleMarkPayoutSent(marketId, payoutId) {
        setError("");
        setBusyAction(`payout-sent-${payoutId}`);
        try {
            await markPayoutSent(token, marketId, payoutId);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage("Payout marked as sent. The winner will now be asked to confirm receipt.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to mark payout as sent.");
        }
        finally {
            setBusyAction("");
        }
    }
    async function handleRespondToPayout(marketId, payoutId, received) {
        setError("");
        setBusyAction(`payout-response-${payoutId}`);
        try {
            await respondToPayout(token, marketId, payoutId, received);
            await refreshWorkspace(token, selectedGroupId);
            setStatusMessage(received
                ? "Payout confirmed. Once every winner confirms, this market will disappear from the board."
                : "Payout dispute sent back to the creator. They need to send payment again.");
        }
        catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Failed to respond to payout confirmation.");
        }
        finally {
            setBusyAction("");
        }
    }
    if (isLoading) {
        return _jsx("main", { className: "shell", children: _jsx("section", { className: "loading-panel", children: "Loading authentication..." }) });
    }
    if (!isAuthenticated) {
        return (_jsx(LandingScreen, { onLogin: () => {
                saveReferralJoinCodeFromUrl();
                void loginWithRedirect({
                    appState: {
                        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`
                    }
                });
            } }));
    }
    if (!profile) {
        return (_jsx("main", { className: "shell", children: _jsx("section", { className: "loading-panel", children: "Loading your workspace..." }) }));
    }
    if (showOnboarding) {
        return (_jsx(OnboardingScreen, { profile: profile, statusMessage: statusMessage, error: error, busyAction: busyAction, needsVenmoHandle: needsVenmoHandle, needsFirstGroup: needsFirstGroup, onboardingReady: onboardingReady, canStartPractice: canStartPractice, onboardingStep: onboardingStep, setOnboardingStep: setOnboardingStep, skipGroupSetupStep: skipGroupSetupStep, groupSetupMode: groupSetupMode, setGroupSetupMode: setGroupSetupMode, referralJoinCode: referralJoinCode, joinCode: joinCode, setJoinCode: setJoinCode, groupName: groupName, setGroupName: setGroupName, venmoHandle: venmoHandle, setVenmoHandle: setVenmoHandle, tutorialDraft: tutorialDraft, tutorialAmountNumber: tutorialAmountNumber, tutorialPracticeStep: tutorialPracticeStep, tutorialHoverTarget: tutorialHoverTarget, setTutorialHoverTarget: setTutorialHoverTarget, tutorialBetPlaced: tutorialBetPlaced, tutorialPrompt: tutorialPrompt, tutorialVenmoUrl: tutorialVenmoUrl, onTutorialSideChange: handleTutorialSideChange, onTutorialAmountChange: handleTutorialAmountChange, onTutorialPlaceBet: handleTutorialPlaceBet, onTutorialPaymentSent: handleTutorialPaymentSent, onSaveVenmoHandle: handleSaveVenmoHandle, onJoinGroup: handleJoinGroup, onCreateGroup: handleCreateGroup, onCompleteTutorial: handleTutorialCompletion }));
    }
    return (_jsx(DashboardScreen, { profile: profile, selectedGroup: selectedGroup, selectedGroupId: selectedGroupId, setSelectedGroupId: setSelectedGroupId, markets: markets, visibleMembers: visibleMembers, tradeDrafts: tradeDrafts, question: question, setQuestion: setQuestion, description: description, setDescription: setDescription, targetUserId: targetUserId, setTargetUserId: setTargetUserId, outcomeLabels: outcomeLabels, setOutcomeLabels: setOutcomeLabels, closesAt: closesAt, setClosesAt: setClosesAt, groupName: groupName, setGroupName: setGroupName, joinCode: joinCode, setJoinCode: setJoinCode, referralJoinCode: referralJoinCode, venmoHandle: venmoHandle, setVenmoHandle: setVenmoHandle, minBet: minBet, setMinBet: setMinBet, maxBet: maxBet, setMaxBet: setMaxBet, requireVenmoForBets: requireVenmoForBets, setRequireVenmoForBets: setRequireVenmoForBets, themePreference: themePreference, resolvedTheme: resolvedTheme, setThemePreference: setThemePreference, selectedGroupInviteUrl: selectedGroupInviteUrl, busyAction: busyAction, error: error, settingsOpen: settingsOpen, setSettingsOpen: setSettingsOpen, familyManagerOpen: familyManagerOpen, setFamilyManagerOpen: setFamilyManagerOpen, onOpenFamilyManager: openFamilyManager, onLogout: () => logout({
            logoutParams: {
                returnTo: window.location.origin
            }
        }), onSaveVenmoHandle: handleSaveVenmoHandle, onRestartTutorial: handleRestartTutorial, onCreateGroup: handleCreateGroup, onJoinGroup: handleJoinGroup, onCopyInviteLink: copyInviteLink, onRemoveGroupMember: handleRemoveGroupMember, onDeleteGroup: handleDeleteGroup, onSaveBetLimits: handleSaveBetLimits, onCreateMarket: handleCreateMarket, onUpdateTradeDraft: updateTradeDraft, onSavePosition: handleSavePosition, onConfirmPosition: handleConfirmPosition, onRejectPosition: handleRejectPosition, onResolve: handleResolve, onConfirmMarketResolution: handleConfirmMarketResolution, onDeleteMarket: handleDeleteMarket, onMarkPayoutSent: handleMarkPayoutSent, onRespondToPayout: handleRespondToPayout }));
}
