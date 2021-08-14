const {writeFile} = require('fs/promises');

for (let i = 0; i < 100; ++i) {
    const calendar = {
        name: `Calendar ${i}`,
        owner: `max+${i}@example.com`,
        shared_with: [
            {user: `max+${i + 1}@example.com`, privilege: 'read-only'},
        ],
        appointments: [],
    };

    for (let j = 0; j < 100; ++j) {
        const date = new Date("2021-06-28T06:00:00+02:00");
        date.setUTCHours(date.getUTCHours() + i + j);
        calendar.appointments.push({
            time: date.toISOString(),
            name: `Appointment ${i} ${j}`,
        });
    }

    writeFile(`${__dirname}/source/c${i}.json`, JSON.stringify(calendar, null, 2));
}
