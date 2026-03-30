const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
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
export function createGroup(token, name) {
    return request("/api/groups", token, {
        method: "POST",
        body: JSON.stringify({ name })
    });
}
export function createGroupWithBalance(token, payload) {
    return createGroup(token, payload.name);
}
export function joinGroup(token, joinCode) {
    return request("/api/groups/join", token, {
        method: "POST",
        body: JSON.stringify({ joinCode })
    });
}
export function joinGroupWithBalance(token, payload) {
    return joinGroup(token, payload.joinCode);
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
export function resolveMarket(token, marketId, resolution) {
    return request(`/api/markets/${marketId}/resolve`, token, {
        method: "POST",
        body: JSON.stringify({ resolution })
    });
}
export function confirmPosition(token, marketId, positionId) {
    return request(`/api/markets/${marketId}/positions/${positionId}/confirm`, token, {
        method: "POST"
    });
}
export function rejectPosition(token, marketId, positionId) {
    return request(`/api/markets/${marketId}/positions/${positionId}`, token, {
        method: "DELETE"
    });
}
export function addGroupBalance(token, groupId, amount) {
    return request(`/api/groups/${groupId}/balance`, token, {
        method: "PATCH",
        body: JSON.stringify({ amount })
    });
}
