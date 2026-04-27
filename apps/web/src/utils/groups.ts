import { REFERRAL_PARAM_KEYS } from "../constants/app";

const JOIN_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/;

export function getReferralJoinCodeFromUrl() {
    if (typeof window === "undefined") {
        return "";
    }

    const searchParams = new URLSearchParams(window.location.search);

    for (const key of REFERRAL_PARAM_KEYS) {
        const value = searchParams.get(key)?.trim().toUpperCase();

        if (value && JOIN_CODE_PATTERN.test(value)) {
            return value;
        }
    }

    return "";
}

export function clearReferralJoinCodeFromUrl() {
    if (typeof window === "undefined") {
        return;
    }

    const nextUrl = new URL(window.location.href);

    for (const key of REFERRAL_PARAM_KEYS) {
        nextUrl.searchParams.delete(key);
    }

    window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

export function buildGroupInviteUrl(joinCode: string) {
    if (typeof window === "undefined") {
        return "";
    }

    const inviteUrl = new URL(window.location.origin + window.location.pathname);
    inviteUrl.searchParams.set("groupCode", joinCode);
    return inviteUrl.toString();
}
