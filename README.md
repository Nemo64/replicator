# ReplicatorDB - The noDB storage solution

This is a concept/prototype.

The basic idea is to replace your traditional SQL or noSQL database with plain-old files.
The is achieved by continuously keeping your queries answered
instead of preparing your data for on-the-fly answering. 

This project then aggregates files (using filesystem events) into different view copies,
so you can build efficient eventually-consistent aggregation/list views for your users.

The aim here is to be an extension to the native filesystem or block storage (s3),
and not a completely new way how to interact with data, like most databases.
That way, this project can profit off of decades of persistence experience.

At best, look into the [examples/](examples) folder to get an idea on how it works.

## Why?

What most **databases** (in general) do is:

- optimize for small records
- allow you to access your records in multiple ways (multiple views)
- allow you to efficiently read multiple records at the same time
- have/require processes that manage access to the underlying storage/cache with special hosting requirements

Other features like search, aggregation, and transactions are specific to database types like SQL.

This is in strong contrast to the normal os-**filesystem** and object storages like **s3** which:

- optimize for larger records/files
- only have a **single way to access a record**/file
- have significant **overhead when accessing multiple records**/files
- require nothing more than a modern kernel and are practically available everywhere

So what you usually do is store application data in a normalized form in a database.
Then you build views for your application that tap into your databases capability to list many records at once.
You do this because you want your clients to get everything they want with as few round-trips as possible,
so giving them a large stream of data with just the properties they need is optimal.

However, that means that most views will require to run some code on your infrastructure that accesses your database,
which consumes some cpu resources and may present scaling issues when you actually have traffic.

## what is this project about?

**This project is about solving the "multiple records/files" issue of filesystems.**

The idea is to eventually consistently aggregate the contents of large source files, based on config files.
Those aggregations will then be stored under different filename schemes based on the content of the aggregated file.
For example usernames, groups, dates, alphabetical ~ whatever you would usually use a secondary index in your database for.
That way, your client application only needs to know the views filename scheme
and can download aggregations, usually without an application layer (besides a web server like nginx).

That does mean we are duplicating a lot of data, but the list of advantages is long:

- Every view is just 1 or more file that is already saved in a deliverable format, so view performance is excellent
- Browsers and CDN's can efficiently download, cache and revalidate files, since the mtime is actually correct
- The linux page cache can improve delivery performance without any configuration
- Your hoster can probably deliver stored files very efficiently
- Replicating and safely storing files is a known and solved issue
- Most programming environments can handle files well
- Shared and exclusive locking is also usually supported (~[usually](https://github.com/denoland/deno/issues/11192))

## Design goals/considerations

- Must work with any filesystem that supports events for easy hackable local development and small/medium deployments.
- Must plug into existing object storage solutions like **AWS S3 with serverless compute**.
- Must not provide an own api to access files, so existing reliable solutions can be used.
- Use web formats for storage, like json, in a way that is directly deliverable without an application layer.
- Updates must scan as few source files as possible, so updates are quick. (less than a second at best)
- Recovery must be possible if watchers or updates are interrupted.
- Don't invent new normalization rules. Work directly with target data structures to minimize abstraction and mapping.
- Make the usually ugly and error prune task of denormalization an easy and obvious one.

## Challenges

- Every write requires a rewrite of an entire file (unless some trickery is used). Since we are talking about sequential
  reads and writes, I don't think that is an issue in most cases. Depending on how your split your base files, those
  could grow indefinitely though.
- Relying entirely on filesystem events could lead to issues on some systems. Mutagen has
  a [great documentation](https://mutagen.io/documentation/synchronization/watching)
  on their challenges and how they solved it.
- Figuring out which views require an update is easy as long as data is added. If data is removed, we'll need access to
  the history of that file to figure out which views were affected. I don't know yet if that can be gracefully solved or
  requires file duplication for later comparison.
- Only a single view is writable and contains the truth. You must only write in your base files.
- There are solutions for atomic writes to files, but I don't know how reliable they are. Write operations are atomic up
  to a point: https://serverfault.com/a/947789
- Rebuilding large amount of views requires some considerations since it might not be feasible to keep all variations in
  ram until all files are scanned.
- Reorganization of the base files will probably result in a change of your public apis, which is undesirable. The
  design should strive to minimize those breaking changes whenever possible.

## Inspirations

This entire concept is based on resolving the multi-view issue of using S3 object storage as database.

The replication idea is inspired by dynamoDB's secondary indexes and [CouchDB Views]
as well as my experience with denormalizing sql tables where join performance becomes an issue.

## calendar example

In a database, you'd usually normalize the data down to basic calendar information and appointments. But for
replicator-db, you want to store as much related data in a single file as possible.

```json5
// source/6ff6255b-45b5-4895-8d59-50fa60663cfc.json
{
    "name": "Personal events",
    "owner": "user+1@example.com",
    "shared_with": [
        {"user": "user+2@example.com", "privilege": "read-only"}
    ],
    "appointments": [
        {"time": "2021-06-28T06:00:00+02:00", "name": "Car inspection"},
        {"time": "2021-07-03T13:30:00+02:00", "name": "Doctor"},
        {"time": "2021-07-04T20:00:00+02:00", "name": "Dinner"}
    ]
}
```

This is ideal if we know the calendar and only want to show the user a single calendar, since we can just download it
and let the frontend handle rendering and filtering.

But you instantly have different access patterns that you can't easily solve with files:

- You want to show the user a list of all calendars he can see (including shared ones)
- You want to show the user all appointments of this week/month over multiple calendars

The replicator-db will duplicate the data (on fs-events) into different structures.

- The main calendar files live in `source/6ff6255b-45b5-4895-8d59-50fa60663cfc.json`
- Replicator-db could store the uuid's, access rights and names of calendars in `lists/user+1@example.com.json`
- Replicator-db could store appointments monthly in `appointments/user+1@example.com/2021-07.json`

If your client application knows these naming schemes, it can just request those files without an application layer on
the server. Some clever web-server/cdn configuration can handle access rights to those folders using jwt authentication
for example.

### database configuration

```json5
// replicator-db.json
{
    "version": "0.0.1",
    "sources": {
        "calendars": {
            "type": "json-fs",
            "path": "source/*.json"
        }
    },
    "views": [
        {
            "source": "calendars",
            // all lists in matrix will be iterated and processed individually
            // this allows to create multiple view files from a single source file
            "matrix": {
                "user": "{source.shared_with|map(.user)|append(source.owner)}"
            },
            // the target file is always a json array at root level
            // multiple source files and view definitions can write into the same target
            "target": {
                "type": "json-fs",
                "path": "views/{matrix.user}/calendars.json"
            },
            // the format is what is actually in a view-item
            "format": {
                "name": "{source.name}",
                "privilege": "{source.shared_with|filter(.user == matrix.user)|map(.privilege)|pick(0)|default('owner')}"
            }
        },
        {
            "source": "calendars",
            // this matrix creates one entry per user per appointment
            "matrix": {
                "user": "{source.shared_with|map(.user)|append(source.owner)}",
                "appointment": "{source.appointments}"
            },
            // multiple entries can have the same file target
            // this means 1 calender can add multiple appointments to the target file 
            "target": {
                "type": "json-fs",
                "path": "views/{matrix.user}/{matrix.appointment.time|strftime('%Y-%m')}.json"
            },
            "format": {
                "calendar": {
                    "name": "{source.name}",
                    "privilege": "{source.shared_with|filter(.user == matrix.user)|map(.privilege)|pick(0)|default('owner')}"
                },
                "name": "{matrix.appointment.name}",
                "time": "{matrix.appointment.time}"
            }
        }
    ]
}
```

## Available patterns

You can reference values using the `{...}` placeholder syntax within strings.
Property paths can be chained using `.` like `first.second.third`.

Available root properties are:

- `{source}` which directly contains the parsed source file
- `{matrix}` contains all properties from the matrix expansion for the current entry

Filters can be accessed and chained using `|filter_name`. Available filters are:

- `|filter(.property == source.property)` which allows you to run `>=`, `==`, `<=` or `!=` expression
  with the capability to access every item using a property path beginning with `.`.
- `|map(.property)` allows to map an array using an expression.
  For example accessing sub properties in an array of objects.
  It is also possible to put filters within the map filter.
- `|strftime('%Y-%m-%d')` allows to format a date using the c strftime syntax.
- `|default('value')` replaces `null` with the specified value.
- `|length` tells the length of a list.
- `|pick(0)` returns a single item from the given list based on the argument or `null` if the list is empty.
  If the argument is a negative number, it will select an item from the end

### generated files

```json5
// views/user+1@example.com/calendars.json
[
    {
        // this field is needed for the efficient aggregation process
        "_source": "6ff6255b-45b5-4895-8d59-50fa60663cfc.json",
        // all other fields are config defined
        "name": "Personal events",
        "privilege": "owner"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "name": "Work events",
        "privilege": "owner"
    },
    {
        "_source": "67763fd6-13df-4a9b-967b-88773380dea7.json",
        "name": "Holidays",
        "privilege": "read-only"
    }
]
```

```json5
// views/user+1@example.com/appointments/2021-07.json
[
    {
        "_source": "6ff6255b-45b5-4895-8d59-50fa60663cfc.json",
        "calendar": {"name": "Personal events", "privilege": "owner"},
        "time": "2021-07-03T13:30:00+02:00",
        "name": "Doctor"
    },
    {
        "_source": "6ff6255b-45b5-4895-8d59-50fa60663cfc.json",
        "calendar": {"name": "Personal events", "privilege": "owner"},
        "time": "2021-07-04T20:00:00+02:00",
        "name": "Dinner"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "calendar": {"name": "Work events", "privilege": "owner"},
        "time": "2021-07-05T10:00:00+02:00",
        "name": "Morning Meeting"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "calendar": {"name": "Work events", "privilege": "owner"},
        "time": "2021-07-12T10:00:00+02:00",
        "name": "Morning Meeting"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "calendar": {"name": "Work events", "privilege": "owner"},
        "time": "2021-07-26T10:00:00+02:00",
        "name": "Morning Meeting"
    }
]
```

[CouchDB Views]: https://docs.couchdb.org/en/stable/ddocs/views/intro.html#what-is-a-view
