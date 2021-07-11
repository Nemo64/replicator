import {v4} from "https://deno.land/std@0.100.0/uuid/mod.ts";

await Promise.all([...Array(100)].map((_, i) => {
    const calendar = {
        name: v4.generate(),
        owner: `max+${i}@example.com`,
        shared_with: [
            {user: `max+${i + 1}@example.com`, privilege: 'read-only'},
        ],
        appointments: [...Array(100)].map((_, i) => {
            const date = new Date;
            date.setHours(date.getHours() - 1000 + Math.random() * 2000);
            return {
                time: date.toISOString(),
                name: `Appointment ${i}`,
            };
        }),
    };

    return Deno.writeTextFile(
        `source/${calendar.name}.json`,
        JSON.stringify(calendar, null, 4),
    );
}));
