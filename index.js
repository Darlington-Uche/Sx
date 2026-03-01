const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const { db } = require('./firebase');
const UserHandler = require('./handlers/userHandler');
const AdminHandler = require('./handlers/adminHandler');
const TaskHandler = require('./handlers/taskHandler');
const RegistrationHandler = require('./handlers/registrationHandler');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Initialize handlers
const userHandler = new UserHandler(bot, db);
const adminHandler = new AdminHandler(bot, db);
const taskHandler = new TaskHandler(bot, db);
const registrationHandler = new RegistrationHandler(bot, db);

// Bot state
let botActive = true;
const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(id => parseInt(id));

// Middleware to check if user is banned
const checkUserBanned = async (userId) => {
  const userDoc = await db.collection('users').doc(userId.toString()).get();
  return userDoc.exists && userDoc.data().banned === true;
};

// Check bot status
bot.on('message', async (msg) => {
  if (!botActive && !ADMIN_IDS.includes(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'Bot is currently under maintenance. Please try again later.');
    return;
  }
  
  if (await checkUserBanned(msg.from.id) && !ADMIN_IDS.includes(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, 'You have been banned from using this bot.');
    return;
  }
});

// Command handlers
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const referralCode = match[1]; // Get referral code if any
  
  // Check if user is admin
  if (ADMIN_IDS.includes(userId)) {
    // Show admin dashboard
    await adminHandler.showAdminDashboard(msg.chat.id);
    return;
  }
  
  const userDoc = await db.collection('users').doc(userId.toString()).get();
  
  if (userDoc.exists && userDoc.data().registered) {
    await userHandler.showDashboard(userId, msg.chat.id);
  } else {
    // Check if this is a referral
    let referrerId = null;
    if (referralCode && referralCode !== userId.toString()) {
      // Verify referrer exists and is registered
      const referrerDoc = await db.collection('users').doc(referralCode).get();
      if (referrerDoc.exists && referrerDoc.data().registered) {
        referrerId = referralCode;
      }
    }
    
    await registrationHandler.startRegistration(userId, msg.chat.id, username, referrerId);
  }
});

// Admin commands
bot.onText(/\/ban (.+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const targetId = match[1];
  await adminHandler.banUser(targetId, msg.chat.id);
});

bot.onText(/\/stop/, async (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  botActive = false;
  await bot.sendMessage(msg.chat.id, '❌ Bot stopped for users');
});

bot.onText(/\/on/, async (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  botActive = true;
  await bot.sendMessage(msg.chat.id, '✅ Bot activated for users');
});

bot.onText(/\/set_pool (.+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const amount = parseFloat(match[1]);
  await adminHandler.setPool(amount, msg.chat.id);
});

bot.onText(/\/search (.+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const query = match[1];
  await adminHandler.searchUsers(query, msg.chat.id);
});

bot.onText(/\/set_min (.+)/, async (msg, match) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  const amount = parseFloat(match[1]);
  await adminHandler.setMinPayout(amount, msg.chat.id);
});

bot.onText(/\/task/, async (msg) => {
  if (!ADMIN_IDS.includes(msg.from.id)) return;
  await taskHandler.showTaskDashboard(msg.chat.id);
});

// Handle button callbacks
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  
try {
  if (ADMIN_IDS.includes(userId)) {
    // Admin callbacks
    if (data.startsWith('admin_')) {
      await adminHandler.handleCallback(data, msg.chat.id, msg.message_id);
    } else if (data.startsWith('task_')) {
      await taskHandler.handleCallback(data, msg.chat.id, msg.message_id);
    } else if (data === 'users_list') {
      await adminHandler.showUsersList(msg.chat.id);
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    } else if (data === 'admin_tasks') {
      await taskHandler.showTaskDashboard(msg.chat.id);
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    } else if (data === 'start_payout') {
      await adminHandler.startPayout(msg.chat.id);
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    } else if (data === 'confirm_payout') {
      await adminHandler.confirmPayout(msg.chat.id);
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    }
  } else {
    // User callbacks
    if (data === 'earn' || data === 'refresh' || data === 'support' || 
        data === 'back' || data.startsWith('user_task_')) {
      await userHandler.handleUserCallback(userId, data, msg.chat.id, msg.message_id);
    } else if (data.startsWith('task_done_')) {
      const taskId = data.replace('task_done_', '');
      await taskHandler.completeTask(userId, taskId, msg.chat.id);
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    }
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
} catch (error) {
  console.error('Callback error:', error);
  await bot.answerCallbackQuery(callbackQuery.id, { text: 'An error occurred' });
}
});

// Handle registration and task creation messages
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const userId = msg.from.id;
    
    // Check if in registration
    const regState = await registrationHandler.getRegistrationState(userId);
    if (regState) {
      await registrationHandler.handleRegistrationInput(userId, msg.chat.id, msg.text, msg.message_id);
      return;
    }
    
    // Check if admin creating task
    if (ADMIN_IDS.includes(msg.from.id)) {
      const taskState = taskHandler.taskCreationState.get(msg.chat.id.toString());
      if (taskState) {
        await taskHandler.handleTaskCreationInput(msg.chat.id, msg.text);
        await bot.deleteMessage(msg.chat.id, msg.message_id);
      }
    }
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('Bot started successfully!');
