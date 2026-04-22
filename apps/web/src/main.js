import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App";
import "./styles.css";
const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(Auth0Provider, { domain: domain, clientId: clientId, onRedirectCallback: (appState) => {
            const returnTo = typeof appState?.returnTo === "string"
                ? appState.returnTo
                : `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.history.replaceState({}, document.title, returnTo);
        }, authorizationParams: {
            redirect_uri: window.location.origin,
            audience,
            scope: "openid profile email"
        }, cacheLocation: "memory", useRefreshTokens: true, children: _jsx(App, {}) }) }));
