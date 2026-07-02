require('dotenv').config();
const cron = require('node-cron');
const { port } = require('./config/env');
const app = require('./app');
const birthdayPostsJob = require('./jobs/birthdayPosts.job');
const biweeklyNotificationsJob = require('./jobs/biweeklyNotifications.job');
const readingRemindersJob = require('./jobs/readingReminders.job');

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

cron.schedule('0 0 * * *', birthdayPostsJob);
cron.schedule('0 0 * * *', biweeklyNotificationsJob);
cron.schedule('0 18 * * *', readingRemindersJob, { timezone: 'Asia/Kolkata' });
