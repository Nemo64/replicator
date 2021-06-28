# Concept/Prototype of ReplicatorDB

This is an attempt to solve storage solutions for web applications in a cost-effective, asynchronous and performant way.

What most **databases** (in general) do is:

- optimize for small records
- allow you to access your records in multiple ways (multiple views)
- allow you to efficiently read multiple records at the same time

Other features like search, aggregation, and transactions are specific to database types like SQL.

This is also in strong contrast to the normal os-**filesystem** and object storages like **s3** which are limited by

- optimize for larger records/files
- only has a single way/view to access a record/file
- accessing multiple records/files comes with significant overhead

So what you usually do is store application data in a normalized form in a database. Then you build views for your
application that tap into your databases capability to list many records at once. You do this because you want your
clients to get everything they want with as few round-trips as possible, so giving them a large stream of data with just
the properties they need is optimal.

However, that means that most views will require to run some code on your infrastructure that accesses your database,
which consumes some cpu resources and may present scaling issues when you actually have traffic.

## what is this project about?

**This project is about solving the "multiple-views" issue of files.**

The idea is to eventually consistently aggregate the contents of files, based on config files, within other known
filename schemes based on the content of those files (eg. usernames, dates or alphabetical). That way, your client
application only needs to know the filename scheme and can download aggregations, usually without an application layer.

- The browser can efficiently cache and revalidate files
- The linux page cache can improve performance without configuration
- Your hoster can probably deliver stored files very efficiently
- CDN's can be a good cache if your files have correctly set modify times
- Replicating and safely storing files is a known and solved issue
- Most programming environments can handle files well
- Shared and exclusive locking is also usually supported

## Design goals/considerations

- Use web formats for storage, like json, in a way that is directly deliverable without an application layer.
- Must work with any filesystem that supports events for easy hackable local development and for small deployments.
- Must plug into existing object storage solutions like **AWS S3 with serverless compute**.
- Updates must scan as few source files as possible, so updates are quick. (less than a second at best)
- Recovery must be possible if watchers or updates are interrupted.
- Don't invent new normalization rules. Work directly with target data structures to minimize abstraction and mapping.
- Make the usually ugly and error prune task of denormalization an easy and obvious one.

## Challenges

- Every write requires a rewrite of an entire file (unless some trickery is used).
  Since we are talking about sequential reads and writes, I don't think that is an issue in most cases.
  Depending on how your split your base files, those could grow indefinitely though.
- Relying entirely on filesystem events could lead to issues on some systems.
  Mutagen has a [great documentation](https://mutagen.io/documentation/synchronization/watching)
  on their challenges and how they solved it.
- Figuring out which views require an update is easy as long as data is added.
  If data is removed, we'll need access to the history of that file to figure out which views were affected.
  I don't know yet if that can be gracefully solved or requires file duplication for later comparison.
- Only a single view is writable and contains the truth. You must only write in your base files.
- There are solutions for atomic writes to files, but I don't know how reliable they are. Write operations are atomic up
  to a point: https://serverfault.com/a/947789
- Rebuilding large amount of views requires some considerations since it might not be feasible to keep all variations in
  ram until all files are scanned.

## Inspirations

This entire concept is based on resolving the multi-view issue of using S3 object storage as database.

The replication idea is inspired by dynamoDB's secondary indexes and [CouchDB Views]
as well as my experience with denormalizing sql tables where join performance becomes an issue.

## calendar example

In a database, you'd usually normalize the data down to basic calendar information and appointments. But for
replicator-db, you want to store as much related data in a single file as possible.

```json5
// calendar/6ff6255b-45b5-4895-8d59-50fa60663cfc.json
{
    "name": "Personal events",
    "owner": "user+1@example.com",
    "shared_with": [
        {
            "user": "user+2@example.com",
            "privilege": "read-only"
        }
    ],
    "appointments": [
        {
            "name": "Car inspection",
            "time": "2021-06-28T06:00:00+02:00"
        },
        {
            "name": "Doctor",
            "time": "2021-07-03T13:30:00+02:00"
        },
        {
            "name": "Dinner",
            "time": "2021-07-04T20:00:00+02:00"
        }
    ]
}
```

This is ideal if we know the calendar and only want to show the user a single calendar, since we can just download it
and let the frontend handle rendering and filtering.

But you instantly have different access patterns that you can't easily solve with files:

- You want to show the user a list of all calendars he can see (including shared ones)
- You want to show the user all appointments of this week/month over multiple calendars

The replicator-db will duplicate the data (on fs-events) into different structures.

- The main calendar files live in `calendar/6ff6255b-45b5-4895-8d59-50fa60663cfc.json`
- Replicator-db could store the uuid's, access rights and names of calendars in `lists/user+1@example.com.json`
- Replicator-db could store appointments monthly in `appointments/user+1@example.com/2021-07.json`

If your client application knows these naming schemes, it can just request those files without an application layer on
the server. Some clever web-server/cdn configuration can handle access rights to those folders using jwt authentication
for example.

### generated files

```json5
// views/user+1@example.com/calendars.json
[
    {
        // these fields are needed for the efficient aggregation process
        "_source": "calendar/6ff6255b-45b5-4895-8d59-50fa60663cfc.json",
        "_lastmod": "2021-06-27T22:12:46.476+02:00",
        // all other fields are config defined
        "calendar": {
            "name": "Personal events",
            "privilege": "owner"
        }
    },
    {
        "_source": "calendar/2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "_lastmod": "2021-06-23T14:56:12.076+02:00",
        "calendar": {
            "name": "Work events",
            "privilege": "owner"
        }
    },
    {
        "_source": "calendar/67763fd6-13df-4a9b-967b-88773380dea7.json",
        "_lastmod": "2021-01-01T00:12:44.202+01:00",
        "calendar": {
            "name": "Holidays",
            "privilege": "read-only"
        }
    }
]
```

```json5
// views/user+1@example.com/2021-07.json
[
    {
        "_source": "calendar/6ff6255b-45b5-4895-8d59-50fa60663cfc.json",
        "_lastmod": "2021-06-27T22:12:46.476+02:00",
        "calendar": {
            "name": "Work events",
            "privilege": "owner"
        },
        "appointments": [
            {
                "name": "Doctor",
                "time": "2021-07-03T13:30:00+02:00"
            },
            {
                "name": "Dinner",
                "time": "2021-07-04T20:00:00+02:00"
            }
        ]
    },
    {
        "_source": "calendar/2732158b-aaa3-4951-aa40-6e9cbac328d0.json",
        "_lastmod": "2021-06-23T14:56:12.076+02:00",
        "calendar": {
            "name": "Work events",
            "privilege": "owner"
        },
        "appointments": [
            {
                "name": "Morning Meeting",
                "time": "2021-07-05T10:00:00+02:00"
            },
            {
                "name": "Morning Meeting",
                "time": "2021-07-12T10:00:00+02:00"
            },
            {
                "name": "Morning Meeting",
                "time": "2021-07-19T10:00:00+02:00"
            },
            {
                "name": "Morning Meeting",
                "time": "2021-07-26T10:00:00+02:00"
            }
        ]
    }
]
```

### database configuration

```json5
// replicator-db.json
{
    "version": "0.0.1",
    "views": [
        {
            "source": "calendar/*.json",
            "matrix": {
                // all lists in matrix will be iterated and processed individually
                // this allows to create multiple view files from a single source file
                "user": "{source.owner,source.shared_with[*].user}"
            },
            // the target file is always a json array at root level
            // multiple source files and view definitions can write into the same target
            "target": "views/{matrix.user}/calendars.json",
            // the format is what is actually in a view-item
            "format": {
                "calendar": {
                    "name": "{source.name}",
                    "privilege": "{source.shared_with[.user == matrix.user]|first.privilege ?? 'owner'}"
                }
            }
        },
        {
            "source": "calendar/*.json",
            "matrix": {
                "user": "{source.owner,source.shared_with[*].user}",
                "date": "{source.appointments[*].time|strftime('%Y-%m')}"
            },
            "target": "views/{matrix.user}/{matrix.time}.json",
            "condition": "{source.appointments[.time|strftime('%Y-%m') == matrix.date]}",
            "format": {
                "calendar": {
                    "name": "{source.name}",
                    "privilege": "{source.shared_with[.user == matrix.user]|first.privilege ?? 'owner'}"
                },
                "appointments": {
                    "_for": {
                        "each": "{source.appointments[.time|strftime('%Y-%m') == matrix.time]}",
                        "as": "appointment"
                    },
                    "name": "{appointment.name}",
                    "time": "{appointment.time}"
                }
            }
        }
    ]
}
```

## Possible access patterns

```jsx
/**
 * This react element shows all calender names that you have access to.
 */
export function CalenderList() {
    const {username} = useLogin();
    const {data: view} = useSwr(`views/${username}/calendars.json`);

    return <ul>
        {view.map(viewItem => (
            <li key={viewItem._source}>{item.calendar.name}</li>
        ))}
    </ul>;
}
```

```jsx
/**
 * This react element will show all appointments from today onwards at least a month in the future
 */
export function NextAppointments() {
    const startTime = new Date();
    startTime.setHours(0, 0, 0); // beginning of the day
    const nextMonth = new Date(startTime.getTime());
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    
    const {username} = useLogin();
    const {data: thisMonthView} = useSwr(username && `views/${username}/${startTime.getUTCFullYear()}${startTime.getUTCMonth() + 1}.json`);
    const {data: nextMonthView} = useSwr(username && `views/${username}/${nextMonth.getUTCFullYear()}${nextMonth.getUTCMonth() + 1}.json`);
    
    const appointments = [thisMonthView, nextMonthView]
        .flatMap(view => view?.appointments ?? []) // extract all the appointment lists
        .filter(appointment => Date.parse(appointment.time) >= startTime.getTime()) // only newer than startTime
        .sort((appointment1, appointment2) => Date.parse(appointment1.time) - Date.parse(appointment2.time))
        .slice(0, 500) // never show more than 500 entries
    
    return <ul>
        {appointments.map(appointment => (
            <li key={`${appointment.time}${appointment.name}`}>
                {Date(appointment.time)} {appointment.name}
            </li>
        ))}
    </ul>
}
```

[CouchDB Views]: https://docs.couchdb.org/en/stable/ddocs/views/intro.html#what-is-a-view
