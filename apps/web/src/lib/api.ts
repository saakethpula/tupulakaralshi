export type FamilyGroup = {
  id: string;
  name: string;
  joinCode: string;
  role: "ADMIN" | "MEMBER";
  balance: number;
  members: Array<{
    id: string;
    displayName: string;
    email: string;
    avatarUrl?: string | null;
    role: "ADMIN" | "MEMBER";
    balance: number;
  }>;
};

export type CurrentUserResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  groups: FamilyGroup[];
};

export type CreatedGroupResponse = {
  id: string;
  name: string;
  joinCode: string;
};

export type Market = {
  id: string;
  question: string;
  description?: string | null;
  closesAt: string;
  resolvesAt?: string | null;
  status: "OPEN" | "CLOSED" | "RESOLVED";
  resolution?: boolean | null;
  createdBy: {
    id: string;
    displayName: string;
  };
  targetUser: {
    id: string;
    displayName: string;
  };
  positions: Array<{
    id: string;
    userId: string;
    side: "YES" | "NO";
    status: "PENDING" | "CONFIRMED";
    amount: number;
    user?: {
      id: string;
      displayName: string;
    };
  }>;
  summary: {
    yesVolume: number;
    noVolume: number;
    totalVolume: number;
    yesPrice: number;
    noPrice: number;
    leadingSide: "YES" | "NO";
  };
  userPosition: {
    yesAmount: number;
    noAmount: number;
    totalAmount: number;
  };
  userPendingPosition: {
    yesAmount: number;
    noAmount: number;
    totalAmount: number;
  };
  userPayout: number;
  venmoRecipient: {
    userId: string;
    displayName: string;
  };
  creatorPayouts: Array<{
    userId: string;
    displayName: string;
    amount: number;
  }>;
  pendingConfirmations: Array<{
    positionId: string;
    userId: string;
    displayName: string;
    side: "YES" | "NO";
    amount: number;
    createdAt: string;
  }>;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? "Request failed.");
  }

  return (await response.json()) as T;
}

export function getCurrentUser(token: string) {
  return request<CurrentUserResponse>("/api/me", token);
}

export function createGroup(token: string, name: string) {
  return createGroupWithBalance(token, { name, startingBalance: 0 });
}

export function createGroupWithBalance(
  token: string,
  payload: { name: string; startingBalance: number }
) {
  return request<CreatedGroupResponse>("/api/groups", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function joinGroup(token: string, joinCode: string) {
  return joinGroupWithBalance(token, { joinCode, startingBalance: 0 });
}

export function joinGroupWithBalance(
  token: string,
  payload: { joinCode: string; startingBalance: number }
) {
  return request<{ joined: boolean; groupId: string }>("/api/groups/join", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getMarkets(token: string, groupId: string) {
  return request<Market[]>(`/api/markets?groupId=${groupId}`, token);
}

export function createMarket(
  token: string,
  payload: {
    groupId: string;
    targetUserId: string;
    question: string;
    description?: string;
    closesAt: string;
    resolvesAt?: string;
  }
) {
  return request<Market>("/api/markets", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function upsertPosition(
  token: string,
  marketId: string,
  payload: { side: "YES" | "NO"; amount: number }
) {
  return request<Market>(`/api/markets/${marketId}/position`, token, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteMarket(token: string, marketId: string) {
  return request<{ deleted: boolean }>(`/api/markets/${marketId}`, token, {
    method: "DELETE"
  });
}

export function resolveMarket(
  token: string,
  marketId: string,
  resolution: boolean
) {
  return request<Market>(`/api/markets/${marketId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify({ resolution })
  });
}

export function confirmPosition(token: string, marketId: string, positionId: string) {
  return request<Market>(`/api/markets/${marketId}/positions/${positionId}/confirm`, token, {
    method: "POST"
  });
}

export function rejectPosition(token: string, marketId: string, positionId: string) {
  return request<Market>(`/api/markets/${marketId}/positions/${positionId}`, token, {
    method: "DELETE"
  });
}

export function addGroupBalance(token: string, groupId: string, amount: number) {
  return request<{ balance: number }>(`/api/groups/${groupId}/balance`, token, {
    method: "PATCH",
    body: JSON.stringify({ amount })
  });
}
