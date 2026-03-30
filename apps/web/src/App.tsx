import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
  addGroupBalance,
  confirmPosition,
  createGroupWithBalance,
  createMarket,
  deleteMarket,
  getCurrentUser,
  getMarkets,
  joinGroupWithBalance,
  rejectPosition,
  resolveMarket,
  upsertPosition,
  type CurrentUserResponse,
  type Market
} from "./lib/api";

const DEFAULT_TRADE_AMOUNT = "25";

function tomorrowAtNoon() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return date.toISOString().slice(0, 16);
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

type TradeDraft = {
  side: "YES" | "NO";
  amount: string;
};

export default function App() {
  const {
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    user,
    getAccessTokenSilently
  } = useAuth0();

  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<CurrentUserResponse | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tradeDrafts, setTradeDrafts] = useState<Record<string, TradeDraft>>({});
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

  const selectedGroup = useMemo(
    () => profile?.groups.find((group) => group.id === selectedGroupId) ?? null,
    [profile, selectedGroupId]
  );

  const visibleMembers = useMemo(
    () =>
      [...(selectedGroup?.members ?? [])].sort((left, right) => right.balance - left.balance),
    [selectedGroup]
  );

  async function refreshProfile(accessToken: string) {
    const nextProfile = await getCurrentUser(accessToken);
    setProfile(nextProfile);
    return nextProfile;
  }

  async function refreshMarkets(accessToken: string, groupId: string) {
    const nextMarkets = await getMarkets(accessToken, groupId);
    setMarkets(nextMarkets);
    setTradeDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };

      for (const market of nextMarkets) {
        if (!nextDrafts[market.id]) {
          nextDrafts[market.id] = {
            side: market.userPosition.noAmount > market.userPosition.yesAmount ? "NO" : "YES",
            amount:
              market.userPosition.totalAmount > 0
                ? String(market.userPosition.totalAmount)
                : DEFAULT_TRADE_AMOUNT
          };
        }
      }

      return nextDrafts;
    });
  }

  async function refreshWorkspace(accessToken: string, groupId: string) {
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
      } catch (requestError) {
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

  function updateTradeDraft(marketId: string, patch: Partial<TradeDraft>) {
    setTradeDrafts((currentDrafts) => ({
      ...currentDrafts,
      [marketId]: {
        side: currentDrafts[marketId]?.side ?? "YES",
        amount: currentDrafts[marketId]?.amount ?? DEFAULT_TRADE_AMOUNT,
        ...patch
      }
    }));
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create group.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleJoinGroup(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to join group.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAddFunds(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to add balance.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateMarket(event: FormEvent<HTMLFormElement>) {
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create market.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSavePosition(marketId: string) {
    const draft = tradeDrafts[marketId] ?? { side: "YES" as const, amount: DEFAULT_TRADE_AMOUNT };
    setError("");
    setBusyAction(`position-${marketId}`);

    try {
      const updatedMarket = await upsertPosition(token, marketId, {
        side: draft.side,
        amount: Number(draft.amount || "0")
      });
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage(
        Number(draft.amount || "0") > 0
          ? `Position submitted. Venmo ${formatMoney(Number(draft.amount || "0"))} to ${updatedMarket.venmoRecipient.displayName}, then wait for creator confirmation.`
          : "Position removed."
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save position.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleConfirmPosition(marketId: string, positionId: string) {
    setError("");
    setBusyAction(`confirm-${positionId}`);

    try {
      await confirmPosition(token, marketId, positionId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Payment confirmed. The position is now live on the market.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to confirm payment.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRejectPosition(marketId: string, positionId: string) {
    setError("");
    setBusyAction(`reject-${positionId}`);

    try {
      await rejectPosition(token, marketId, positionId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Pending position rejected and funds returned.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to reject payment.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleResolve(marketId: string, resolution: boolean) {
    setError("");
    setBusyAction(`resolve-${marketId}`);

    try {
      await resolveMarket(token, marketId, resolution);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Market resolved and balances settled.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to resolve market.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteMarket(marketId: string) {
    setError("");
    setBusyAction(`delete-${marketId}`);

    try {
      await deleteMarket(token, marketId);
      await refreshWorkspace(token, selectedGroupId);
      setStatusMessage("Market removed and all positions refunded.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to remove market.");
    } finally {
      setBusyAction("");
    }
  }

  if (isLoading) {
    return <main className="shell"><section className="loading-panel">Loading authentication...</section></main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="shell landing-shell">
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="kicker">Family Prediction Market</p>
            <h1>Private forecasting with sharper stakes and cleaner secrets.</h1>
            <p className="hero-lede">
              Spin up hidden markets, manage family bankrolls, and settle results automatically in a dashboard that feels more like a modern trading desk than a school project.
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => void loginWithRedirect()}>
                Enter the market
              </button>
              <div className="hero-note">
                Hidden from the subject, visible to the family, settled by real balances.
              </div>
            </div>
          </div>
          <div className="hero-preview">
            <div className="preview-card">
              <span className="preview-label">Live signal</span>
              <strong>72% YES</strong>
              <p>Will Jordan finally announce the move before July?</p>
            </div>
            <div className="preview-card">
              <span className="preview-label">Balance engine</span>
              <strong>{formatMoney(1240)}</strong>
              <p>Track available cash, committed stakes, and automatic winner payouts.</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell app-shell">
      <section className="dashboard-hero">
        <div>
          <p className="kicker">Trading desk</p>
          <h1>{user?.name ?? profile?.user.displayName ?? "Family member"}</h1>
          <p className="hero-lede">
            Build private calls, shift bankroll between positions, and settle the whole market without spreadsheets.
          </p>
        </div>
        <div className="hero-meta">
          <div className="metric-panel">
            <span className="metric-label">Available balance</span>
            <strong>{formatMoney(selectedGroup?.balance ?? 0)}</strong>
            <small>{selectedGroup?.name ?? "Choose a family group"}</small>
          </div>
          <div className="hero-controls">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              {settingsOpen ? "Close settings" : "Settings"}
            </button>
            <button
              className="ghost-button"
              onClick={() =>
                logout({
                  logoutParams: {
                    returnTo: window.location.origin
                  }
                })
              }
            >
              Log out
            </button>
          </div>
        </div>
      </section>

      <section className="status-banner">
        <span>{statusMessage}</span>
        {error ? <strong>{error}</strong> : null}
      </section>

      <section className="dashboard-grid">
        <aside className="sidebar-stack">
          <article className="panel family-strip">
            <div className="panel-heading">
              <div>
                <p className="kicker">Current family</p>
                <h2>{selectedGroup?.name ?? "Choose a family group"}</h2>
              </div>
              <span className="subtle-copy">
                {selectedGroup ? `Join code ${selectedGroup.joinCode}` : "Pick a group in settings"}
              </span>
            </div>
            <div className="group-selector vertical">
              {profile?.groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={selectedGroupId === group.id ? "group-pill active" : "group-pill"}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <span>{group.name}</span>
                  <strong>{formatMoney(group.balance)}</strong>
                  <small>{group.joinCode}</small>
                </button>
              ))}
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

          {settingsOpen ? (
            <article className="panel settings-panel">
              <div className="panel-heading">
                <div>
                  <p className="kicker">Settings</p>
                  <h2>Groups and bankroll</h2>
                </div>
              </div>
              <div className="settings-grid">
                <form onSubmit={handleAddFunds} className="form-stack compact-form">
                  <span className="subtle-copy">Add funds to the current group</span>
                  <input
                    type="number"
                    min="1"
                    value={topUpAmount}
                    onChange={(event) => setTopUpAmount(event.target.value)}
                    placeholder="Amount"
                    required
                  />
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={!selectedGroupId || busyAction === "top-up"}
                  >
                    Add to balance
                  </button>
                </form>

                <form onSubmit={handleCreateGroup} className="form-stack compact-form">
                  <span className="subtle-copy">Create a new family group</span>
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder="The Parkers"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    value={groupStartingBalance}
                    onChange={(event) => setGroupStartingBalance(event.target.value)}
                    placeholder="Opening balance"
                    required
                  />
                  <button className="primary-button" type="submit" disabled={busyAction === "create-group"}>
                    Create group
                  </button>
                </form>

                <form onSubmit={handleJoinGroup} className="form-stack compact-form">
                  <span className="subtle-copy">Join another family group</span>
                  <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    placeholder="Join code"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    value={joinStartingBalance}
                    onChange={(event) => setJoinStartingBalance(event.target.value)}
                    placeholder="Opening balance"
                    required
                  />
                  <button className="ghost-button" type="submit" disabled={busyAction === "join-group"}>
                    Join group
                  </button>
                </form>
              </div>
            </article>
          ) : null}

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">Members</p>
                <h2>Bankroll leaderboard</h2>
              </div>
            </div>
            <div className="member-grid sidebar-members">
              {visibleMembers.map((member) => (
                <div key={member.id} className="member-card">
                  <div>
                    <strong>{member.displayName}</strong>
                    <span>{member.role}</span>
                  </div>
                  <strong>{formatMoney(member.balance)}</strong>
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
            <form onSubmit={handleCreateMarket} className="create-market-grid">
              <select
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
                required
              >
                <option value="">Choose who the market is about</option>
                {selectedGroup?.members
                  .filter((member) => member.id !== profile?.user.id)
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
                Hidden markets stay invisible to the person they target.
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
                  const canRemove =
                    market.createdBy.id === profile?.user.id || selectedGroup?.role === "ADMIN";

                  return (
                    <article key={market.id} className="market-panel">
                      <div className="market-topline">
                        <div>
                          <p className="kicker">About {market.targetUser.displayName}</p>
                          <h3>{market.question}</h3>
                        </div>
                        <span className={`status-pill ${market.status.toLowerCase()}`}>{market.status}</span>
                      </div>

                      {market.description ? <p className="market-copy">{market.description}</p> : null}

                      <div className="market-stats">
                        <div>
                          <span>YES</span>
                          <strong>{Math.round(market.summary.yesPrice * 100)}%</strong>
                        </div>
                        <div>
                          <span>Total pot</span>
                          <strong>{formatMoney(market.summary.totalVolume)}</strong>
                        </div>
                        <div>
                          <span>Live stake</span>
                          <strong>{formatMoney(market.userPosition.totalAmount)}</strong>
                        </div>
                        <div>
                          <span>Closes</span>
                          <strong>{new Date(market.closesAt).toLocaleString()}</strong>
                        </div>
                      </div>

                      <div className="market-rail">
                        <div className="market-rail-card">
                          <span>Creator</span>
                          <strong>{market.createdBy.displayName}</strong>
                        </div>
                        <div className="market-rail-card">
                          <span>Leading side</span>
                          <strong>{market.summary.leadingSide}</strong>
                        </div>
                        <div className="market-rail-card">
                          <span>Payout to you</span>
                          <strong>{formatMoney(market.userPayout)}</strong>
                        </div>
                      </div>

                      <div className="trade-box">
                        <div className="trade-toggle">
                          <button
                            type="button"
                            className={draft.side === "YES" ? "toggle-button active-yes" : "toggle-button"}
                            onClick={() => updateTradeDraft(market.id, { side: "YES" })}
                          >
                            YES
                          </button>
                          <button
                            type="button"
                            className={draft.side === "NO" ? "toggle-button active-no" : "toggle-button"}
                            onClick={() => updateTradeDraft(market.id, { side: "NO" })}
                          >
                            NO
                          </button>
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={draft.amount}
                          onChange={(event) => updateTradeDraft(market.id, { amount: event.target.value })}
                          placeholder="Stake amount"
                        />
                        <button
                          className="primary-button"
                          type="button"
                          disabled={busyAction === `position-${market.id}` || market.status !== "OPEN"}
                          onClick={() => void handleSavePosition(market.id)}
                        >
                          {market.userPosition.totalAmount > 0 ? "Update position" : "Place position"}
                        </button>
                        {market.status === "OPEN" ? (
                          <p className="trade-note">
                            After saving, Venmo {formatMoney(Number(draft.amount || "0"))} to {market.venmoRecipient.displayName} so the market creator can escrow the pool.
                          </p>
                        ) : null}
                        {market.userPendingPosition.totalAmount > 0 ? (
                          <p className="trade-note pending-note">
                            Pending confirmation: {formatMoney(market.userPendingPosition.totalAmount)}. This will not affect the market until {market.venmoRecipient.displayName} confirms receipt.
                          </p>
                        ) : null}
                      </div>

                      {market.pendingConfirmations.length > 0 && market.createdBy.id === profile?.user.id ? (
                        <div className="settlement-box">
                          <div className="settlement-heading">
                            <span className="kicker">Pending receipts</span>
                            <strong>Confirm Venmo before the stake goes live</strong>
                          </div>
                          <div className="settlement-list">
                            {market.pendingConfirmations.map((pending) => (
                              <div key={pending.positionId} className="settlement-row pending-row">
                                <div>
                                  <span>{pending.displayName}</span>
                                  <small>
                                    {pending.side} for {formatMoney(pending.amount)}
                                  </small>
                                </div>
                                <div className="market-footer-actions">
                                  <button
                                    className="ghost-button yes-outline"
                                    type="button"
                                    disabled={busyAction === `confirm-${pending.positionId}`}
                                    onClick={() => void handleConfirmPosition(market.id, pending.positionId)}
                                  >
                                    Confirm payment
                                  </button>
                                  <button
                                    className="ghost-button no-outline"
                                    type="button"
                                    disabled={busyAction === `reject-${pending.positionId}`}
                                    onClick={() => void handleRejectPosition(market.id, pending.positionId)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {market.status === "RESOLVED" && market.createdBy.id === profile?.user.id ? (
                        <div className="settlement-box">
                          <div className="settlement-heading">
                            <span className="kicker">Creator payout sheet</span>
                            <strong>Send these payouts now</strong>
                          </div>
                          {market.creatorPayouts.length === 0 ? (
                            <p className="subtle-copy">
                              Nobody backed the winning side. Refund bettors if you handled this market off-platform.
                            </p>
                          ) : (
                            <div className="settlement-list">
                              {market.creatorPayouts.map((payout) => (
                                <div key={payout.userId} className="settlement-row">
                                  <span>{payout.displayName}</span>
                                  <strong>{formatMoney(payout.amount)}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="market-footer">
                        <span className="subtle-copy">
                          Current split: {formatMoney(market.userPosition.yesAmount)} YES / {formatMoney(market.userPosition.noAmount)} NO
                        </span>
                        <div className="market-footer-actions">
                          {canRemove ? (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={busyAction === `delete-${market.id}` || market.status === "RESOLVED"}
                              onClick={() => void handleDeleteMarket(market.id)}
                            >
                              Remove market
                            </button>
                          ) : null}
                          {selectedGroup?.role === "ADMIN" && market.status !== "RESOLVED" ? (
                            <>
                              <button
                                className="ghost-button yes-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void handleResolve(market.id, true)}
                              >
                                Resolve YES
                              </button>
                              <button
                                className="ghost-button no-outline"
                                type="button"
                                disabled={busyAction === `resolve-${market.id}`}
                                onClick={() => void handleResolve(market.id, false)}
                              >
                                Resolve NO
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </article>
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
