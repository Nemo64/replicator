# Replicator - The noDB storage solution

This is a concept/prototype. Please give me feedback.

The idea is to replace your traditional SQL or noSQL database with plain-old files.
The is achieved by continuously keeping your queries answered when the sources change
instead of preparing your data for on-the-fly answering. 

Replicator aggregates files (using filesystem events) into different view copies,
so you can build efficient eventually-consistent aggregation/list views for your users.

That does mean we are duplicating a lot of data, but the list of advantages is long:

- Every view is just 1 or more file that is already saved in a deliverable format, so view performance is excellent
- Browsers and CDN's can efficiently download, cache and revalidate files, since the mtime is actually correct
- The os file cache automatically improve delivery performance without any complex configuration
- Your hoster can probably deliver stored files very efficiently
- Replicating and safely storing files is a known and solved issue
- Most programming environments can handle files well, no integration required

The aim is to be an extension to the native filesystem or block storage (s3),
and not a completely new way how to interact with data, like most databases.
That way, this project can profit off of decades of persistence experience (raid, SAM, nfs, rsync, mounts etc)
and existing deliver systems (apache, nginx, CDN's etc) without reinventing the wheel.

## calendar example

This example is available in the [examples/](examples) folder to play around with.

In a database, you'd usually normalize the data down to basic calendar information and appointments.
But for replicator, you want to store as much related data in a single file as possible.

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

Replicator can duplicate the data into different structures.

- The main calendar files live in `source/6ff6255b-45b5-4895-8d59-50fa60663cfc.json`
- Replicator can store the uuid's, access rights and names of calendars in `views/user+1@example.com/calendars.json`
- Replicator can store appointments monthly in `views/user+1@example.com/2021-07.json`

If your client application knows these naming schemes, it can just request those files without an application layer.
Use jwt claims to handle access rights if needed, and you are done.

### database configuration

```json5
// replicator-db.json
{
    "sources": {
        "calendars": {
            "type": "replicator:filesystem",
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
                "type": "replicator:filesystem",
                "path": "views/{matrix.user}/calendars.json"
            },
            // the format is what is actually in a view-item
            "format": {
                "name": "{source.name}",
                "privilege": "{source.shared_with|filter(.user == matrix.user)|map(.privilege)|pick|default('owner')}"
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
                "type": "replicator:filesystem",
                "path": "views/{matrix.user}/{matrix.appointment.time|strftime('%Y-%m')}.json"
            },
            "format": {
                "calendar": {
                    "name": "{source.name}",
                    "privilege": "{source.shared_with|filter(.user == matrix.user)|map(.privilege)|pick|default('owner')}"
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
- `|pick(0)` returns a single item from the given list based on the argument or `null` if the item does not exist.
  If the argument is a negative number, it will select an item from the end of an array.

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
        "privilege": "read-only"
    },
    {
        "_source": "67763fd6-13df-4a9b-967b-88773380dea7.json",
        "name": "Holidays",
        "privilege": "read-only"
    }
]
```

```json5
// views/user+1@example.com/2021-07.json
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
        "calendar": {"name": "Work events", "privilege": "read-only"},
        "time": "2021-07-05T10:00:00+02:00",
        "name": "Morning Meeting"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "calendar": {"name": "Work events", "privilege": "read-only"},
        "time": "2021-07-12T10:00:00+02:00",
        "name": "Morning Meeting"
    },
    {
        "_source": "2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "calendar": {"name": "Work events", "privilege": "read-only"},
        "time": "2021-07-26T10:00:00+02:00",
        "name": "Morning Meeting"
    }
]
```

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
- Working reliably with filesystems isn't too easy, see https://www.slideshare.net/nan1nan1/eat-my-data
- Relying entirely on filesystem events could lead to issues on some systems. Mutagen has
  a [great documentation](https://mutagen.io/documentation/synchronization/watching)
  on their challenges and how they solved it.
- Figuring out which views require an update is easy as long as data is added. If data is removed, we'll need access to
  the history of that file to figure out which views were affected. I don't know yet if that can be gracefully solved or
  requires file duplication for later comparison.
- Only a single view is writable and contains the truth. You must only write in your base files.
- Rebuilding large amount of views requires some considerations since it might not be feasible to keep all variations in
  ram until all files are scanned.
- Reorganization of the base files will probably result in a change of your public apis, which is undesirable. The
  design should strive to minimize those breaking changes whenever possible.

## Inspirations

This entire concept is based on resolving the multi-view issue of using S3 object storage as database.

The replication idea is inspired by dynamoDB's secondary indexes and [CouchDB Views]
as well as my experience with denormalizing sql tables where join performance becomes an issue.


[CouchDB Views]: https://docs.couchdb.org/en/stable/ddocs/views/intro.html#what-is-a-view
