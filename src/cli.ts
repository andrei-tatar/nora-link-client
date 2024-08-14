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
    .option<LogLevel>('-l, --log <log-level>', `min log level to display. Options: ${LOG_LEVEL.join(',')}`, (value, previous) => {
        const v = value?.toLowerCase() as LogLevel;
        if (LOG_LEVEL.includes(v)) {
            return v;
        }
        return previous;
    }, 'info')
    .requiredOption('-f, --forward <subdomain|label|url...>', 'Tunnel subdomain to local url. Label is optional')
    .requiredOption('-k, --key <api-key>', 'Api Key')
    .requiredOption('-h, --host <hostname>', 'Server host name', 'noralink.eu')
    .addHelpText('afterAll', 'To tunnel a local port to the subdomain `test`, you can use `-f test|:3000`')
    .addHelpText('afterAll', 'To tunnel an ip to the subdomain `test`, you can use `-f test|192.168.1.130`')
    .parse();

const options = program.opts();

let tunnels: ClientConnectionOptions['tunnels'] = [];
if (Array.isArray(options.forward)) {
    tunnels = options.forward
        .filter((v): v is string => typeof v === 'string')
        .map(v => {
            const [segment, labelOrUrl, urlPart] = v.split('|');
            let toUrl: string;

            const label = urlPart ? labelOrUrl : segment;
            const url = urlPart ?? labelOrUrl;

            if (/^https?:\/\//.test(url)) {
                toUrl = url;
            } else if (url.startsWith(':')) {
                //only port specified
                const port = +url.split(':')[1];
                toUrl = `http://127.0.0.1:${port}`;
            } else {
                toUrl = `http://${url}`;
            }

            return { remotePath: segment, localUrl: toUrl, label };
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