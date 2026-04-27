import type { User } from "@prisma/client";
import type { Request, Response } from "express";
import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer } from "ws";
import { allowedFrontendOrigins } from "../config.js";
import { prisma } from "../db.js";
import { attachCurrentUser, requireAuth } from "../middleware/auth.js";

type WorkspaceInvalidateMessage = {
  type: "workspace.invalidate";
  at: string;
  reason: string;
  groupIds: string[];
};

type ClientConnection = {
  socket: {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  userId: string;
};

const clientsByUserId = new Map<string, Set<ClientConnection>>();

function registerConnection(connection: ClientConnection) {
  const userConnections = clientsByUserId.get(connection.userId) ?? new Set<ClientConnection>();
  userConnections.add(connection);
  clientsByUserId.set(connection.userId, userConnections);
}

function unregisterConnection(connection: ClientConnection) {
  const userConnections = clientsByUserId.get(connection.userId);

  if (!userConnections) {
    return;
  }

  userConnections.delete(connection);

  if (userConnections.size === 0) {
    clientsByUserId.delete(connection.userId);
  }
}

function sendToUsers(userIds: Iterable<string>, message: WorkspaceInvalidateMessage) {
  const payload = JSON.stringify(message);
  const seenUserIds = new Set<string>();

  for (const userId of userIds) {
    if (seenUserIds.has(userId)) {
      continue;
    }

    seenUserIds.add(userId);

    for (const connection of clientsByUserId.get(userId) ?? []) {
      if (connection.socket.readyState === 1) {
        connection.socket.send(payload);
      }
    }
  }
}

function normalizeOrigin(origin: string | undefined) {
  if (!origin) {
    return "";
  }

  return origin.trim().replace(/\/+$/, "");
}

function createMiddlewareResponse() {
  let statusCode = 200;

  const response = {
    status(nextStatusCode: number) {
      statusCode = nextStatusCode;
      return response;
    },
    json(payload: { message?: string }) {
      throw new Error(payload.message ?? `WebSocket authorization failed with status ${statusCode}.`);
    },
    end() {
      return response;
    },
    setHeader() {
      return response;
    },
    getHeader() {
      return undefined;
    }
  };

  return response as unknown as Response;
}

async function runMiddleware(
  request: Request,
  response: Response,
  middleware: (req: Request, res: Response, next: (error?: unknown) => void) => unknown
) {
  await new Promise<void>((resolve, reject) => {
    void Promise.resolve(middleware(request, response, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    })).catch(reject);
  });
}

async function authenticateWebSocketRequest(incomingMessage: IncomingMessage, token: string) {
  const host = incomingMessage.headers.host ?? "localhost";
  const requestUrl = new URL(incomingMessage.url ?? "/ws", `http://${host}`);
  const request = incomingMessage as Request;
  const mutableRequest = request as any;

  mutableRequest.query = Object.fromEntries(requestUrl.searchParams.entries());
  mutableRequest.body = {};
  mutableRequest.headers = {
    ...incomingMessage.headers,
    authorization: `Bearer ${token}`
  };
  mutableRequest.method = incomingMessage.method ?? "GET";
  mutableRequest.url = incomingMessage.url ?? "/ws";
  mutableRequest.originalUrl = incomingMessage.url ?? "/ws";
  mutableRequest.protocol = "https";
  mutableRequest.app = { get: () => undefined } as unknown as Request["app"];
  mutableRequest.get = (headerName: string) => {
    const headerValue = mutableRequest.headers[headerName.toLowerCase()];

    if (Array.isArray(headerValue)) {
      return headerValue.join(", ");
    }

    return headerValue;
  };
  mutableRequest.is = () => false;

  const response = createMiddlewareResponse();

  await runMiddleware(request, response, requireAuth);
  await runMiddleware(request, response, attachCurrentUser);

  return request.currentUser as User | undefined;
}

function parseAuthMessage(payload: unknown) {
  if (typeof payload !== "string") {
    return null;
  }

  try {
    const message = JSON.parse(payload) as { type?: unknown; token?: unknown };

    if (message.type === "auth" && typeof message.token === "string" && message.token.length > 0) {
      return message.token;
    }
  } catch {
    return null;
  }

  return null;
}

function sendConnectedMessage(socket: ClientConnection["socket"]) {
  socket.send(JSON.stringify({
    type: "workspace.invalidate",
    at: new Date().toISOString(),
    reason: "socket.connected",
    groupIds: []
  } satisfies WorkspaceInvalidateMessage));
}

async function resolveGroupMemberUserIds(groupIds: string[]) {
  if (groupIds.length === 0) {
    return [];
  }

  const memberships = await prisma.groupMembership.findMany({
    where: {
      groupId: {
        in: groupIds
      }
    },
    select: {
      userId: true
    }
  });

  return [...new Set(memberships.map((membership) => membership.userId))];
}

export function initializeRealtimeServer(server: HttpServer) {
  const webSocketServer = new WebSocketServer({
    server,
    path: "/ws"
  });

  webSocketServer.on("connection", async (socket: any, request: IncomingMessage) => {
    const origin = normalizeOrigin(request.headers.origin);

    if (origin && !allowedFrontendOrigins.includes(origin)) {
      socket.close(1008, "Origin not allowed.");
      return;
    }

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.close(1008, "Unauthorized.");
      }
    }, 5000);
    socket.on("close", () => {
      clearTimeout(authTimeout);
    });

    socket.on("message", async (payload: unknown) => {
      if (authenticated) {
        return;
      }

      try {
        const token = parseAuthMessage(payload);

        if (!token) {
          socket.close(1008, "Unauthorized.");
          return;
        }

        const currentUser = await authenticateWebSocketRequest(request, token);

        if (!currentUser) {
          socket.close(1008, "Unauthorized.");
          return;
        }

        authenticated = true;
        clearTimeout(authTimeout);

        const connection: ClientConnection = {
          socket,
          userId: currentUser.id
        };

        registerConnection(connection);
        sendConnectedMessage(socket);

        socket.on("close", () => {
          unregisterConnection(connection);
        });

        socket.on("error", () => {
          unregisterConnection(connection);
        });
      } catch (error) {
        console.error("Failed to authenticate WebSocket connection.", error);
        socket.close(1008, "Unauthorized.");
      }
    });
  });

  return webSocketServer;
}

export function notifyUsers(userIds: Iterable<string>, reason: string, groupIds: string[] = []) {
  sendToUsers(userIds, {
    type: "workspace.invalidate",
    at: new Date().toISOString(),
    reason,
    groupIds
  });
}

export async function notifyGroupMembers(groupId: string, reason: string) {
  try {
    const userIds = await resolveGroupMemberUserIds([groupId]);
    notifyUsers(userIds, reason, [groupId]);
  } catch (error) {
    console.error("Failed to notify group members.", error);
  }
}

export async function notifyUserGroups(userId: string, reason: string) {
  try {
    const memberships = await prisma.groupMembership.findMany({
      where: { userId },
      select: {
        groupId: true
      }
    });

    const groupIds = memberships.map((membership) => membership.groupId);
    const groupMemberUserIds = await resolveGroupMemberUserIds(groupIds);

    notifyUsers(new Set([userId, ...groupMemberUserIds]), reason, groupIds);
  } catch (error) {
    console.error("Failed to notify user groups.", error);
  }
}
