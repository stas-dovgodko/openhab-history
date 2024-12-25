const {rules, items, triggers, cache, actions} = require('openhab');

class HistoryWrapper 
{
    constructor(item, group)
    {
        this.item = item;
        this.group = group;

        rules.JSRule({
            name: "Track history events for " + group,
            triggers: [triggers.ItemStateChangeTrigger(item.name)],
            execute: (event) => {
                this.#push(event.newState);
            },
            tags: ['HistoryWrapper'],
            id: `history_${item.name}`,
            overwrite: true
        });
    }

    #push(state)
    {
        const filename = "/etc/openhab/html/history/data/events.json";

        let thread = (function() {
            console.log(this.filename + " -- " + this.state);
            cache.shared.put(this.filename, Date.now());

            try {
                let path = java.nio.file.Paths.get(this.filename);

                let data = {data:[]};
                if (java.nio.file.Files.exists(path)) {
                    data = JSON.parse(java.nio.file.Files.readString(path));
                }
                if (!data.hasOwnProperty('data')) {
                    data.data = [];
                }
                data.data.unshift(this.state);

                if (data.data.length > 150) {
                    let prev_next = data.next;
                    // move to archive
                    let archive = { ...data }; let ts = Date.now();
                    data.data = data.data.slice(0, 50);
                    data.next = ts;

                    archive.data = archive.data.slice(100);

                    let archives = new java.lang.String(JSON.stringify(archive));

                    java.nio.file.Files.write(java.nio.file.Paths.get("/etc/openhab/html/history/data/events_" + data.next + ".json"), archives.getBytes());

                    if (prev_next) {
                        let prev_path = java.nio.file.Paths.get("/etc/openhab/html/history/data/events_" + prev_next + ".json");
                        if (java.nio.file.Files.exists(prev_path)) {
                            const prev_data = JSON.parse(java.nio.file.Files.readString(prev_path));
                            prev_data.prev = data.next;

                            let prev_archive = new java.lang.String(JSON.stringify(prev_data));

                            java.nio.file.Files.write(prev_path, prev_archive.getBytes());
                        }
                    }
                }

                let s = new java.lang.String(JSON.stringify(data));

                java.nio.file.Files.write(path, s.getBytes());
            } finally {
                cache.shared.remove(this.filename);
            }
        }).bind({state:state,filename:filename});
        
        let locked = cache.shared.get(filename);

        if ((locked !== null) && (locked >= Date.now() - 2000)) {
            // wait for unlock
            console.log(filename + " is locked! Wait for 3s");
            setTimeout(() => {
                thread();
            }, 3000)
        } else {
            thread();
        }
        
    }

    #format(format) {
        var args = Array.prototype.slice.call(arguments, 1);

        return format.replace(/{(\d+)}/g, function(match, number) { 
          return typeof args[number] != 'undefined'
            ? args[number]
            : match
          ;
        });
    }

    #archive(payload)
    {
        const options = {
            key: this.group,
            group: actions.Transformation.transform('MAP', 'history.map', this.group),
            ts: Date.now()
        }

        this.item.sendCommand(JSON.stringify({...payload, ...options}));
    }

    info(message, details) 
    {
        this.#archive({
            level: "info",
            message: message, 
            details: details
        });
    }

    warning(message, details) 
    {
        this.#archive({
            level: "warning",
            message: message, 
            details: details
        });
    }

    error(message, details) 
    {
        this.#archive({
            level: "error",
            message: message, 
            details: details
        });
    }

    recover(message, details) 
    {
        this.#archive({
            level: "recover",
            message: message, 
            details: details
        });
    }

    context(message)
    {
        items.metadata.replaceMetadata(this.item, 'context', message);
    }


    logCommand(item, command, before, details, level)
    {
        let message = this.#format(actions.Transformation.transform('MAP', 'history.map', "{0} command to {1}"), command, items.getItem(item).label);

        if (before) {
            message += ". " + this.#format(actions.Transformation.transform('MAP', 'history.map', "Current state: {0}"), before);
        }

        this.log(message, details, level);
    }

    log(message, details, level)
    {
        if (level === undefined) level = 'info';

        this.#archive({
            level: level,
            message: message, 
            details: details
        });
    }

    logOn(item, details, level)
    {
        let message = this.#format(actions.Transformation.transform('MAP', 'history.map', "{0} is turned ON"), item);
        this.log(message, details, level);
    }

    logOff(item, details, level)
    {
        let message = this.#format(actions.Transformation.transform('MAP', 'history.map', "{0} is turned OFF"), item);

        this.log(message, details, level);
    }
}

function history_item(group) {
    const history_item_name = items.safeItemName(`${group}_history`);

    if (items.getItem(history_item_name, true) === null) {
        items.addItem({
            type: 'String',
            name: history_item_name,
            //label: `${this.contact.label} history`,
            //category: 'light',
            //groups: [group],
            //tags: this.contact.tags.concat(["History"]),
            //metadata: {
            /*expire: '10m,command=1',
            stateDescription: {
                config: {
                pattern: '%d%%',
                options: '1=Red, 2=Green, 3=Blue'
                }
            }*/
            //}
        });
    }

    return new HistoryWrapper(items.getItem(history_item_name, false), group);
}

module.exports = new Proxy({history_item}, {
    get: function (target, prop) {
        return target[prop] || target.history_item(prop);
    }
});
