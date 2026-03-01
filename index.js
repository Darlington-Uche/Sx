const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const { db } = require('./firebase');
const UserHandler = require('./handlers/userHandler');
const AdminHandler = require('./handlers/adminHandler');
const TaskHandler = require('./handlers/taskHandler');
const RegistrationHandler = require('./handlers/registrationHandler');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

// Initialize Express app
const app = express();
app.use(express.json());

// Set webhook
const webhookUrl = process.env.WEBHOOK_URL; // e.g., 'https://your-domain.com/webhook'
bot.setWebHook(`${webhookUrl}/bot${token}`);

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

// Webhook endpoint
app.post(`/bot${token}`, async (req, res) => {
  try {
    const update = req.body;
    
    // Handle message
    if (update.message) {
      const msg = update.message;
      
      // Check bot status
      if (!botActive && !ADMIN_IDS.includes(msg.from.id)) {
        await bot.sendMessage(msg.chat.id, 'Bot is currently under maintenance. Please try again later.');
        return res.sendStatus(200);
      }

      if (await checkUserBanned(msg.from.id) && !ADMIN_IDS.includes(msg.from.id)) {
        await bot.sendMessage(msg.chat.id, 'You have been banned from using this bot.');
        return res.sendStatus(200);
      }

      // Handle commands and messages
      if (msg.text) {
        // Start command with optional referral
        if (msg.text.startsWith('/start')) {
          const match = msg.text.match(/\/start(?:\s+(.+))?/);
          const referralCode = match ? match[1] : null;
          
          const userId = msg.from.id;
          const username = msg.from.username || `user_${userId}`;

          if (ADMIN_IDS.includes(userId)) {
            await adminHandler.showAdminDashboard(msg.chat.id);
          } else {
            const userDoc = await db.collection('users').doc(userId.toString()).get();
            
            if (userDoc.exists && userDoc.data().registered) {
              await userHandler.showDashboard(userId, msg.chat.id);
            } else {
              let referrerId = null;
              if (referralCode && referralCode !== userId.toString()) {
                const referrerDoc = await db.collection('users').doc(referralCode).get();
                if (referrerDoc.exists && referrerDoc.data().registered) {
                  referrerId = referralCode;
                }
              }
              await registrationHandler.startRegistration(userId, msg.chat.id, username, referrerId);
            }
          }
        }
        // Admin commands
        else if (msg.text.startsWith('/ban') && ADMIN_IDS.includes(msg.from.id)) {
          const match = msg.text.match(/\/ban (.+)/);
          if (match) {
            await adminHandler.banUser(match[1], msg.chat.id);
          }
        }
        else if (msg.text === '/stop' && ADMIN_IDS.includes(msg.from.id)) {
          botActive = false;
          await bot.sendMessage(msg.chat.id, '❌ Bot stopped for users');
        }
        else if (msg.text === '/on' && ADMIN_IDS.includes(msg.from.id)) {
          botActive = true;
          await bot.sendMessage(msg.chat.id, '✅ Bot activated for users');
        }
        else if (msg.text.startsWith('/set_pool') && ADMIN_IDS.includes(msg.from.id)) {
          const match = msg.text.match(/\/set_pool (.+)/);
          if (match) {
            await adminHandler.setPool(parseFloat(match[1]), msg.chat.id);
          }
        }
        else if (msg.text.startsWith('/search') && ADMIN_IDS.includes(msg.from.id)) {
          const match = msg.text.match(/\/search (.+)/);
          if (match) {
            await adminHandler.searchUsers(match[1], msg.chat.id);
          }
        }
        else if (msg.text.startsWith('/set_min') && ADMIN_IDS.includes(msg.from.id)) {
          const match = msg.text.match(/\/set_min (.+)/);
          if (match) {
            await adminHandler.setMinPayout(parseFloat(match[1]), msg.chat.id);
          }
        }
        else if (msg.text === '/task' && ADMIN_IDS.includes(msg.from.id)) {
          await taskHandler.showTaskDashboard(msg.chat.id);
        }
        // Non-command messages
        else {
          const userId = msg.from.id;

          // Check if in registration
          const regState = await registrationHandler.getRegistrationState(userId);
          if (regState) {
            await registrationHandler.handleRegistrationInput(userId, msg.chat.id, msg.text, msg.message_id);
          }

          // Check if admin creating task
          if (ADMIN_IDS.includes(msg.from.id)) {
            const taskState = taskHandler.taskCreationState.get(msg.chat.id.toString());
            if (taskState) {
              await taskHandler.handleTaskCreationInput(msg.chat.id, msg.text);
            }
          }
        }
      }
    }
    
    // Handle callback queries
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
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
          } else if (data === 'admin_tasks') {
            await taskHandler.showTaskDashboard(msg.chat.id);
          } else if (data === 'start_payout') {
            await adminHandler.startPayout(msg.chat.id);
          } else if (data === 'confirm_payout') {
            await adminHandler.confirmPayout(msg.chat.id);
          }
        } else {
          // User callbacks
          if (data === 'earn' || data === 'refresh' || data === 'support' || 
              data === 'back' || data.startsWith('user_task_')) {
            await userHandler.handleUserCallback(userId, data, msg.chat.id, msg.message_id);
          } else if (data.startsWith('task_done_')) {
            const taskId = data.replace('task_done_', '');
            await taskHandler.completeTask(userId, taskId, msg.chat.id);
          }
        }

        await bot.answerCallbackQuery(callbackQuery.id);
      } catch (error) {
        console.error('Callback error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'An error occurred' });
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', botActive });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook set to: ${webhookUrl}/bot${token}`);
});

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});