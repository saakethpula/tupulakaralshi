const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
export function getRealtimeWebSocketUrl() {
    const realtimeUrl = new URL(apiBaseUrl);
    realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
    realtimeUrl.pathname = "/ws";
    realtimeUrl.search = "";
    return realtimeUrl.toString();
}
async function request(path, token, init) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init?.headers ?? {})
        }
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null));
        throw new Error(body?.message ?? "Request failed.");
    }
    return (await response.json());
}
export function getCurrentUser(token) {
    return request("/api/me", token);
}
export function updateVenmoHandle(token, venmoHandle) {
    return request("/api/me", token, {
        method: "PATCH",
        body: JSON.stringify({ venmoHandle })
    });
}
export function updateTutorialCompletion(token, completed) {
    return request("/api/me/tutorial", token, {
        method: "PATCH",
        body: JSON.stringify({ completed })
    });
}
export function createGroup(token, name) {
    return request("/api/groups", token, {
        method: "POST",
        body: JSON.stringify({ name })
    });
}
export function joinGroup(token, joinCode) {
    return request("/api/groups/join", token, {
        method: "POST",
        body: JSON.stringify({ joinCode })
    });
}
export function removeGroupMember(token, groupId, memberId) {
    return request(`/api/groups/${groupId}/members/${memberId}`, token, {
        method: "DELETE"
    });
}
export function updateGroupBetLimits(token, groupId, minBet, maxBet) {
    return request(`/api/groups/${groupId}/bet-limits`, token, {
        method: "PATCH",
        body: JSON.stringify({ minBet, maxBet })
    });
}
export function deleteGroup(token, groupId) {
    return request(`/api/groups/${groupId}`, token, {
        method: "DELETE"
    });
}
export function getMarkets(token, groupId) {
    return request(`/api/markets?groupId=${groupId}`, token);
}
export function createMarket(token, payload) {
    return request("/api/markets", token, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export function upsertPosition(token, marketId, payload) {
    return request(`/api/markets/${marketId}/position`, token, {
        method: "PUT",
        body: JSON.stringify(payload)
    });
}
export function deleteMarket(token, marketId) {
    return request(`/api/markets/${marketId}`, token, {
        method: "DELETE"
    });
}
export function resolveMarket(token, marketId, outcomeId) {
    return request(`/api/markets/${marketId}/resolve`, token, {
        method: "POST",
        body: JSON.stringify({ outcomeId })
    });
}
export function confirmMarketResolution(token, marketId) {
    return request(`/api/markets/${marketId}/resolution/confirm`, token, {
        method: "POST"
    });
}
export function confirmPosition(token, marketId, positionId) {
    return request(`/api/markets/${marketId}/positions/${positionId}/confirm`, token, {
        method: "POST"
    });
}
export function markPayoutSent(token, marketId, payoutId) {
    return request(`/api/markets/${marketId}/payouts/${payoutId}/sent`, token, {
        method: "POST"
    });
}
export function respondToPayout(token, marketId, payoutId, received) {
    return request(`/api/markets/${marketId}/payouts/${payoutId}/respond`, token, {
        method: "POST",
        body: JSON.stringify({ received })
    });
}
export function rejectPosition(token, marketId, positionId) {
    return request(`/api/markets/${marketId}/positions/${positionId}`, token, {
        method: "DELETE"
    });
}
