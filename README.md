# @nora-link/client

This package helps you access your private http/ws servers inside your home network, securely, from the internet, **without the hassle of setting up**.

## Getting an API key

1. Go to [https://noralink.eu/home](https://noralink.eu/home) and create an account
2. Navigate from the dropdown (or follow [link](https://noralink.eu/home/api-keys)) to the **Manage API keys** menu
3. Create a new key and copy it somewhere safe


## Creating a tunnel

The following command creates a tunnel under subdomain `app` to `internal-server.local:1234/sample-path`. Replace `[your-api-key]` with the API key you obtained before.

`npx @nora-link/client -f "app|internal-server.local:1234/sample-path" -k [your-api-key]`

You can also specify a label to be displayed in the UI:

`npx @nora-link/client -f "app|This is my test app|internal-server.local:1234/sample-path" -k [your-api-key]`

Or you can create multiple tunnels to different apps:

`npx @nora-link/client -f "app|app1.local:1234" -f "test|app2.local:1234" -k [your-api-key]`

## Accessing the tunnel

You can acess the tunnel by navigating to [https://noralink.eu/home](https://noralink.eu/home) and clicking the card corresponding your tunnel, or by going directly to the subdomain associated to your tunnerl. Eg: [https://app.noralink.eu](https://app.noralink.eu).


## Available subdomains

Currently only a subset of subdomains are available to use with your own tunnels, from the following: *admin, api, app, control, dashboard, home, my, nodered, smarthome, test*.

If you want a new subdomain, add a request here: [Request a new subdomain thread](https://github.com/andrei-tatar/nora-link-client/issues/1).

## Security

- #### End-to-End TLS Encryption
  All traffic from the client machine to the user’s browser is encrypted using TLS, ensuring data security during transmission.
- #### Certificate Management by Google Cloud
  Certificates for the service are handled by Google Cloud, providing robust and trusted certificate management.
- #### Secure WebSocket Tunneling
  Traffic is tunneled via a secure WebSocket connection, and is only accessible to the authenticated user.
- #### Authentication with External Providers
  Users can create accounts using Google and GitHub identity providers or via email/password. This flexibility enhances the user experience while providing secure authentication methods.
- #### Email Verification for Email/Password Signups
  Email/password accounts require email verification, adding an extra layer of security. MFA is not yet supported for email/password.
- #### Scoped Access with API Key
  The client uses an API key, generated from the browser, which is only shown once and hashed after creation. The key is scoped to the user, ensuring access is limited to tunnels created only by that user. API keys are never stored in plaintext; only their hash is kept, minimizing the risk of exposure.
- #### HttpOnly Secure Cookie for Session Management
  Browser authentication is maintained via a secure, HttpOnly cookie with a 12-hour expiration, reducing the risk of session hijacking.
- #### Open Source, Lightweight Client
  The client source code is open source, providing transparency, and is lightweight, reducing the attack surface and complexity.
- #### Host-Specific Access Control
  The server can only access pre-defined local hosts specified in the config, ensuring that no unauthorized access to other local services is possible.


## Pricing

This service is currently free to use, but as our cloud costs grow, we plan to charge for use to cover the costs. This
means that while basic features will remain free, full access and advanced features will require a subscription. We
appreciate your understanding and support as we continue to improve our service.