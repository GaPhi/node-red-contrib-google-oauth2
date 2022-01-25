module.exports = function (RED) {

    "use strict";

    function encodeAPI(name, version) {
        return name + ':' + version;
    }

    function decodeAPI(api) {
        var a = api.split(':', 2);
        return {
            name: a[0],
            version: a[1]
        };
    }

    function getOAuth2Client(configNode) {
        if (configNode == null) return null;
        if (configNode.oauth2Client == null) {        
            configNode.updatedTokensFile = `${RED.settings.userDir}/${configNode.id}.json`;
            if (!fs.existsSync(configNode.updatedTokensFile)) {
                configNode.log(`Create GoogleNode tokens file ${configNode.updatedTokensFile}`);
                fs.writeFileSync(configNode.updatedTokensFile, '{}');
            }
            if (fs.existsSync(configNode.updatedTokensFile)) {
                var lastTokens = JSON.parse(fs.readFileSync(configNode.updatedTokensFile));
                configNode.credentials.accessToken = lastTokens?.accessToken ?? configNode.credentials.accessToken;
                configNode.credentials.refreshToken = lastTokens?.refreshToken ?? configNode.credentials.refreshToken;
                configNode.scopes = lastTokens?.scopes ?? configNode.scopes;
                configNode.credentials.tokenType = lastTokens?.tokenType ?? configNode.credentials.tokenType;
                configNode.credentials.expireTime = lastTokens?.expireTime ?? configNode.credentials.expireTime;
                configNode.log(`GoogleNode tokens restored from ${configNode.updatedTokensFile}`);
            }
            configNode.oauth2Client = new google.auth.OAuth2(
                configNode.credentials.clientId,
                configNode.credentials.clientSecret
            );
            configNode.oauth2Client.setCredentials({
                access_token: configNode.credentials.accessToken,
                refresh_token: configNode.credentials.refreshToken,
                scope: configNode.scopes.replace(/\n/g, " "),
                token_type: configNode.credentials.tokenType,
                expiry_date: configNode.credentials.expireTime
            });
            configNode.oauth2Client.on('tokens', (tokens) => {
                configNode.credentials.accessToken  = tokens.access_token ?? configNode.credentials.accessToken;
                configNode.credentials.refreshToken = tokens.refresh_token ?? configNode.credentials.refreshToken;
                configNode.scopes = tokens.scope?.replace(/ /g, "\n") ?? configNode.credentials.scopes;
                configNode.credentials.tokenType = tokens.token_type ?? configNode.credentials.tokenType;
                configNode.credentials.expireTime = tokens.expiry_date ?? configNode.credentials.expireTime;
                RED.nodes.addCredentials(configNode.id, configNode.credentials);
                if (configNode.id != null) {
                    var lastTokens = {
                        accessToken: configNode.credentials.accessToken,
                        refreshToken: configNode.credentials.refreshToken,
                        scopes: configNode.scopes,
                        tokenType: configNode.credentials.tokenType,
                        expireTime: configNode.credentials.expireTime,
                    };
                    fs.writeFileSync(configNode.updatedTokensFile, JSON.stringify(lastTokens, null, 2));
                    configNode.log(`GoogleNode tokens updated and saved in ${configNode.updatedTokensFile}`);
                }
          });
        }
        return configNode.oauth2Client;
    }
    
    const fs = require("fs");
    var {google}  = require('googleapis');
    var discovery = google.discovery({version: 'v1'});

    RED.httpAdmin.get('/google/apis', function (req, res) {
        discovery.apis.list({
            fields: "items(name,version)"
        }, function (err, data) {
            var response = [];
            data.data.items.forEach(function (v) {
                response.push(encodeAPI(v.name, v.version));
            });
            response.sort();
            res.json(response);
        });
    });

    RED.httpAdmin.get('/google/apis/:api/info', function (req, res) {

        var api = decodeAPI(req.params.api);

        discovery.apis.getRest({
            api: api.name,
            version: api.version,
            fields: "auth,methods,resources"
        }, function (err, data) {

            if (err) {
                return res.status(500).json(err);
            }

            var response = {
                operations: [],
                scopes: []
            };

            function processResources(d, parent) {
                var prefix = parent ? parent + '.' : '';
                if (d.methods) {
                    Object.keys(d.methods).forEach(function (k) {
                        response.operations.push(prefix + k);
                    });
                }
                if (d.resources) {
                    Object.keys(d.resources).forEach(function (k) {
                        processResources(d.resources[k], prefix + k);
                    });
                }
            }

            processResources(data.data);

            response.operations.sort();
            response.scopes = Object.keys(data.data.auth.oauth2.scopes);

            res.json(response);

        });
    });

    function GoogleNode(config) {

        RED.nodes.createNode(this, config);
        var node       = this;
        node.config    = RED.nodes.getNode(config.google);
        node.api       = config.api;
        node.operation = config.operation;
        node.scopes    = config.scopes;


        node.on('input', function (msg) {

            node.status({
                fill: 'blue',
                shape: 'dot',
                text: 'pending'
            });

            var api = decodeAPI(node.api);
            api     = google[api.name]({
                version: api.version,
                auth: getOAuth2Client(node.config),
            });

            var props     = (node.operation || msg.operation).split('.');
            var operation = api;
            props.forEach(function (val) {
                operation = operation[val];
            });

            operation.bind(api)(msg.payload, function (err, res) {
                if (err) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: 'error'
                    });
                    node.error(err,msg);
                    return;
                }

                node.status({
                    fill: 'yellow',
                    shape: 'dot',
                    text: 'success'
                });

                msg.payload = res.data;
                node.send(msg);
            });

        });
    }

    RED.nodes.registerType("google", GoogleNode);

};
