# @nora-link/client

This package helps you access your private servers inside your home network, securely, from the internet, without the hassle of setting up.

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