# Calendar example

This example demonstrates a calendars that are shared with an infinite amount of people.

Storing calendars itself is not a big issue but efficiently sharing them is because you'll have these access patterns:
- Show the user a list of all calendars he can see
- Show the user all appointments over multiple calendars

These patterns would usually require some sort of database where you can access
calenders and appointments by their owner or shared user.

However, replicator can continuously generate you view files that contain that information per user.
Every time a calendar is modified, replicator will check if views need to be updated and does so based on configuration. 

## Run the replicator daemon

This command will start the replicator daemon which will watch the source folder for changes.

Go ahead and play around with the source files.

```sh
npm start examples/calendar/replicator.json
```

To generate some calendars, use the generate command

```sh
node generate.js
```

## Folder Structure

Replicator does not specify a project structure for you.
The config file you pass the daemon contains all path.

However, it is still a good idea to have a clear structure.
This is the structure for this example:

- [`schemas/*.json`](schemas) [JSON Schema] files for basic validation. (Optional)
- [`source/[uuid].json`](source) A JSON file per calendar. You (and your hypothetical app) can edit these.
- [`views/`](views) Contains generated json views. Views are the aggregations from the `source/` files-
    - `[email]/[year]-[month].json` Lists of all appointments that are shared with the user in that month.
    - `[email]/calendars.json` A list of calendar id's and names that are shared with the user.
- [`replicator-db.json`](replicator-db.json) Is the config file for the database that you need to pass to the daemon.

## Thoughts on the architecture

### Calendars are just large file objects

- Need some calendars for local testing? Just copy some over.
- Need to run backups? File based backups are just fine and can be distributed if needed.
- Someone wants his data in a GDPR request? Just `grep` all calendars with his username and give him those.

You can basically manage your application data with an sshfs mount and your local file explorer.

### Growth

The architecture is based on the assumtion that a user has a finite amount of appointments per calendar+month
and that the client application is able to handle that amount of data.

I don't foresee any issues with the appointment list, as every entry is small
(~ 1 kb if we expect a real world scenario with additional fields like description location etc).
Even if the user has 1000 appointments per month (~33 per day), it would amount to 1 mb of uncompressed json.

There is a great (but old) article "[How Big is TOO BIG for JSON?]" with benchmarks
that give you an idea of how much data you can put in a package.
Since [If-Modified-Since] is a thing, you also don't have to worry about
the user downloading that same package every 5 minutes.
If you sprinkle a bit of [Content-Encoding] in the mix, you should be golden.

The main calendar file could become an issue though.
You may want to archive old calendar entries after a size or time threshold during an update.
A possible pattern could be `[uuid]-[year].json` where you just copy old appointments over
and update all other properties whenever you do so.
You could even sell it as a feature that very old entries (+2 years) retain their context.   
Those archived calendar entries can still be used to generate the appointment views.

## Possible access patterns

```jsx
/**
 * This react element shows all calender names that you have access to.
 */
export function CalenderList() {
    const {username} = useLogin();
    const {data: calendars} = useSWR(`/views/${username}/calendars.json`);

    return <ul>
        {calendars?.map(calendar =>
            <li key={calendar._source}>{calendar.name}</li>
        )}
    </ul>;
}
```

```jsx
/**
 * This react element will show all appointments from today onwards at least a month in the future
 */
export function NextAppointments() {
    const startTime = new Date();
    startTime.setHours(0, 0, 0, 0); // beginning of the day in users timezone

    const {username} = useLogin();
    const pager = pageIndex => {
        const date = new Date(startTime.getTime());
        date.setUTCMonth(date.getUTCMonth() + pageIndex);
        return username && `/views/${username}/${date.getUTCFullYear()}-${date.getUTCMonth() + 1}.json`
    }

    const {data: pages, size, setSize, isValidating} = useSWRInfinite(pager, null, {initialSize: 2});
    const appointments = pages
        .flatMap(page => Array.isArray(page) ? page : []) // spread pages to flat array
        .filter(appointment => Date.parse(appointment.time) >= startTime.getTime()) // only newer than startTime
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time)); // sort by time

    return <ul>
        {appointments?.map(appointment =>
            <li key={`${appointment._source} ${appointment.time} ${appointment.name}`}>
                {Date(appointment.time)} {appointment.name}
            </li>
        )}
        {isValidating && (
            <li>loading...</li>
        )}
        {!isValidating && size < 12 && (
            <li><button type="button" onClick={() => setSize(size + 1)}>load more</button></li>
        )}
    </ul>
}
```

[JSON Schema]: https://json-schema.org/understanding-json-schema/
[How Big is TOO BIG for JSON?]: https://joshzeigler.com/technology/web-development/how-big-is-too-big-for-json
[If-Modified-Since]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Modified-Since
[Content-Encoding]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
