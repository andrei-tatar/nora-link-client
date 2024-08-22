#!/usr/bin/env node

import { program } from 'commander';
import { Client, ClientConnectionOptions } from './client';
import { createConsoleLogger, LOG_LEVEL, LogLevel } from './logger';

const { name, version } = require('../package.json');

program
    .name(name)
    .version(version, '-v, --version')
    .usage('[OPTIONS]...')
    .option('-d, --debug', 'output extra debugging', false)
    .option('-n, --non-secure', 'don\'t use secure connection', false)
    .option('-h, --host <hostname>', 'Server host name')
    .option<LogLevel>('-l, --log <log-level>', `min log level to display. Options: ${LOG_LEVEL.join(',')}`, (value, previous) => {
        const v = value?.toLowerCase() as LogLevel;
        if (LOG_LEVEL.includes(v)) {
            return v;
        }
        return previous;
    }, 'info')
    .requiredOption('-f, --forward <subdomain|label|url...>', 'Tunnel subdomain to local url. Label is optional')
    .requiredOption('-k, --key <api-key>', 'Api Key')
    .addHelpText('afterAll', 'To tunnel a local port to the subdomain `test`, you can use `-f "test|localhost:3000"`')
    .addHelpText('afterAll', 'To tunnel an ip to the subdomain `test`, you can use `-f "test|192.168.1.130"`')
    .addHelpText('afterAll', 'To tunnel a local hostname to the subdomain `test` with label `My App`, you can use `-f "test|My App|local-host.local"`')
    .parse();

const options = program.opts();

let tunnels: ClientConnectionOptions['tunnels'] = [];
if (Array.isArray(options.forward)) {
    tunnels = options.forward
        .filter((v): v is string => typeof v === 'string')
        .map(v => {
            const [segment, labelOrUrl, urlPart] = v.split('|');

            const label = urlPart ? labelOrUrl : segment;
            let url = urlPart ?? labelOrUrl;

            const urlHasProtocol = /^https?:\/\//.test(url);
            if (!urlHasProtocol) {
                //if missing protocol, assume http
                url = `http://${url}`;
            }

            return { remotePath: segment, url, label };
        });
}

if (!tunnels.length) {
    console.info('no valid tunnels specified');
    process.exit(1);
}
else {
    new Client({
        agent: `${name}@${version}`,
        hostname: options.host,
        secure: !options.nonSecure,
        tunnels,
        apiKey: options.key,
        logger: createConsoleLogger(options.log),
    }).handle$.subscribe();
}