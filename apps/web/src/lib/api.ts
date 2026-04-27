export type FamilyGroup = {
  id: string;
  name: string;
  joinCode: string;
  minBet: number;
  maxBet: number;
  role: "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    displayName: string;
    email: string;
    avatarUrl?: string | null;
    venmoHandle?: string | null;
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
    venmoHandle?: string | null;
    hasCompletedTutorial: boolean;
    balance: number;
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
  status: "OPEN" | "CLOSED" | "PENDING_RESOLUTION" | "RESOLVED";
  resolution?: boolean | null;
  resolutionOutcomeId?: string | null;
  resolutionProposedBy?: {
    id: string;
    displayName: string;
  } | null;
  createdBy: {
    id: string;
    displayName: string;
  };
  targetUser: {
    id: string;
    displayName: string;
  } | null;
  targetUserId: string | null;
  isGeneral: boolean;
  positions: Array<{
    id: string;
    userId: string;
    side?: "YES" | "NO" | null;
    outcomeId?: string | null;
    status: "PENDING" | "CONFIRMED";
    amount: number;
    user?: {
      id: string;
      displayName: string;
    };
  }>;
  summary: {
    outcomes: Array<{
      id: string;
      label: string;
      volume: number;
      price: number;
    }>;
    yesVolume: number;
    noVolume: number;
    totalVolume: number;
    yesPrice: number;
    noPrice: number;
    leadingSide: string;
    leadingOutcome: {
      id: string;
      label: string;
      volume: number;
      price: number;
    };
  };
  outcomes: Array<{
    id: string;
    label: string;
    sortOrder: number;
  }>;
  userPosition: {
    yesAmount: number;
    noAmount: number;
    totalAmount: number;
    outcomeAmounts: Array<{
      id: string;
      label: string;
      amount: number;
    }>;
  };
  userPendingPosition: {
    yesAmount: number;
    noAmount: number;
    totalAmount: number;
    outcomeAmounts: Array<{
      id: string;
      label: string;
      amount: number;
    }>;
  };
  userPayout: number;
  venmoRecipient: {
    userId: string;
    displayName: string;
    venmoHandle?: string | null;
  };
  creatorPayouts: Array<{
    userId: string;
    displayName: string;
    amount: number;
  }>;
  payoutConfirmations: Array<{
    id: string;
    recipientUserId: string;
    displayName: string;
    venmoHandle?: string | null;
    amount: number;
    status: "PENDING_CREATOR" | "PENDING_RECIPIENT" | "DISPUTED" | "CONFIRMED";
    creatorMarkedAt?: string | null;
    recipientRespondedAt?: string | null;
  }>;
  creatorPayoutsPendingCount: number;
  userPayoutConfirmation: {
    id: string;
    recipientUserId: string;
    displayName: string;
    venmoHandle?: string | null;
    amount: number;
    status: "PENDING_CREATOR" | "PENDING_RECIPIENT" | "DISPUTED" | "CONFIRMED";
    creatorMarkedAt?: string | null;
    recipientRespondedAt?: string | null;
  } | null;
  resolutionConfirmations: Array<{
    id: string;
    userId: string;
    displayName: string;
    createdAt: string;
  }>;
  resolutionConfirmationCount: number;
  requiredResolutionConfirmations: number;
  userResolutionConfirmation: {
    id: string;
    userId: string;
    displayName: string;
    createdAt: string;
  } | null;
  pendingConfirmations: Array<{
    positionId: string;
    userId: string;
    displayName: string;
    outcomeId?: string | null;
    outcomeLabel: string;
    amount: number;
    createdAt: string;
  }>;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export function getRealtimeWebSocketUrl() {
  const realtimeUrl = new URL(apiBaseUrl);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
  realtimeUrl.pathname = "/ws";
  realtimeUrl.search = "";
  return realtimeUrl.toString();
}

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

export function updateVenmoHandle(token: string, venmoHandle: string) {
  return request<{ user: CurrentUserResponse["user"] }>("/api/me", token, {
    method: "PATCH",
    body: JSON.stringify({ venmoHandle })
  });
}

export function updateTutorialCompletion(token: string, completed: boolean) {
  return request<{ user: CurrentUserResponse["user"] }>("/api/me/tutorial", token, {
    method: "PATCH",
    body: JSON.stringify({ completed })
  });
}

export function createGroup(token: string, name: string) {
  return request<CreatedGroupResponse>("/api/groups", token, {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export function joinGroup(token: string, joinCode: string) {
  return request<{ joined: boolean; groupId: string }>("/api/groups/join", token, {
    method: "POST",
    body: JSON.stringify({ joinCode })
  });
}

export function removeGroupMember(token: string, groupId: string, memberId: string) {
  return request<{ removed: boolean }>(`/api/groups/${groupId}/members/${memberId}`, token, {
    method: "DELETE"
  });
}

export function updateGroupBetLimits(token: string, groupId: string, minBet: number, maxBet: number) {
  return request<{ group: FamilyGroup }>(`/api/groups/${groupId}/bet-limits`, token, {
    method: "PATCH",
    body: JSON.stringify({ minBet, maxBet })
  });
}

export function deleteGroup(token: string, groupId: string) {
  return request<{ deleted: boolean }>(`/api/groups/${groupId}`, token, {
    method: "DELETE"
  });
}

export function getMarkets(token: string, groupId: string) {
  return request<Market[]>(`/api/markets?groupId=${groupId}`, token);
}

export function createMarket(
  token: string,
  payload: {
    groupId: string;
    targetUserId?: string | null;
    question: string;
    description?: string;
    closesAt: string;
    resolvesAt?: string;
    outcomes?: string[];
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
  payload: { outcomeId: string; amount: number }
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
  outcomeId: string
) {
  return request<Market>(`/api/markets/${marketId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify({ outcomeId })
  });
}

export function confirmMarketResolution(token: string, marketId: string) {
  return request<Market>(`/api/markets/${marketId}/resolution/confirm`, token, {
    method: "POST"
  });
}

export function confirmPosition(token: string, marketId: string, positionId: string) {
  return request<Market>(`/api/markets/${marketId}/positions/${positionId}/confirm`, token, {
    method: "POST"
  });
}

export function markPayoutSent(token: string, marketId: string, payoutId: string) {
  return request<Market>(`/api/markets/${marketId}/payouts/${payoutId}/sent`, token, {
    method: "POST"
  });
}

export function respondToPayout(token: string, marketId: string, payoutId: string, received: boolean) {
  return request<Market>(`/api/markets/${marketId}/payouts/${payoutId}/respond`, token, {
    method: "POST",
    body: JSON.stringify({ received })
  });
}

export function rejectPosition(token: string, marketId: string, positionId: string) {
  return request<Market>(`/api/markets/${marketId}/positions/${positionId}`, token, {
    method: "DELETE"
  });
}
