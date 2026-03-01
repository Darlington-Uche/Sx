class AdminHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
  }

  async showAdminDashboard(chatId) {
    try {
      // Get counts
      const usersSnapshot = await this.db.collection('users').get();
      const usersCount = usersSnapshot.size;

      // Get total balance
      let totalBalance = 0;
      usersSnapshot.forEach(doc => {
        totalBalance += doc.data().balance || 0;
      });

      // Get today's pool
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const todayPool = poolDoc.exists ? poolDoc.data().amount || 0 : 0;

      // Get eligible users for today
      const settingsDoc = await this.db.collection('settings').doc('config').get();
      const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;

      let eligibleUsers = 0;
      usersSnapshot.forEach(doc => {
        if ((doc.data().balance || 0) >= minPayout) {
          eligibleUsers++;
        }
      });

      // Get tasks count
      const tasksSnapshot = await this.db.collection('tasks').get();
      const tasksCount = tasksSnapshot.size;

      // Get admins count
      const adminsCount = process.env.ADMIN_IDS.split(',').length;

      // Determine if payout can be started (not when both are zero)
      const canStartPayout = !(todayPool === 0 && totalBalance === 0);

      const adminText = `
👋 *Welcome, Admin*

👥 Users count: ${usersCount}
💰 Total Balance: ${totalBalance.toFixed(2)} MB
📦 Today's pool: ${todayPool.toFixed(2)} MB
🎯 Eligible users: ${eligibleUsers}
📊 Status: Active
📋 Earn Tasks: ${tasksCount}
👤 Admins: ${adminsCount}
⚡ Darlington says 👋

*Available Commands:*
/ban [id] - Ban user
/stop - Stop bot for users
/on - Start bot for users
/set_pool [amount] - Set pool (only when pool = 0)
/search [query] - Search users
/set_min [amount] - Set minimum payout
/task - Manage tasks
      `;

      const inlineKeyboard = [
        [
          { text: '👥 Users', callback_data: 'users_list' },
          { text: '💰 Start Payout', callback_data: 'start_payout' }
        ],
        [
          { text: '📋 Tasks', callback_data: 'admin_task' },
          { text: '🔄 Refresh', callback_data: 'admin_dashboard' }
        ]
      ];

      // Disable payout button if both pool and balance are zero
      if (!canStartPayout) {
        inlineKeyboard[0][1] = { text: '💰 Start Payout (Disabled)', callback_data: 'payout_disabled' };
      }

      await this.bot.sendMessage(chatId, adminText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
    } catch (error) {
      console.error('Admin dashboard error:', error);
      await this.bot.sendMessage(chatId, 'Error loading admin dashboard.');
    }
  }

  async banUser(targetId, chatId) {
    try {
      await this.db.collection('users').doc(targetId.toString()).update({
        banned: true
      });
      await this.bot.sendMessage(chatId, `✅ User ${targetId} has been banned.`);
    } catch (error) {
      console.error('Ban error:', error);
      await this.bot.sendMessage(chatId, 'Error banning user.');
    }
  }

  async setPool(amount, chatId) {
    try {
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const currentPool = poolDoc.exists ? poolDoc.data().amount : 0;

      if (currentPool !== 0) {
        await this.bot.sendMessage(chatId, '❌ Pool can only be set when it is 0');
        return;
      }

      await this.db.collection('settings').doc('pool').set({
        amount: amount,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await this.bot.sendMessage(chatId, `✅ Pool set to ${amount} MB`);
    } catch (error) {
      console.error('Set pool error:', error);
      await this.bot.sendMessage(chatId, 'Error setting pool.');
    }
  }

  async setMinPayout(amount, chatId) {
    try {
      await this.db.collection('settings').doc('config').set({
        minPayout: amount,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await this.bot.sendMessage(chatId, `✅ Minimum payout set to ${amount} MB`);
    } catch (error) {
      console.error('Set min payout error:', error);
      await this.bot.sendMessage(chatId, 'Error setting minimum payout.');
    }
  }

  async searchUsers(query, chatId) {
    try {
      const usersSnapshot = await this.db.collection('users').get();
      const results = [];

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (user.username?.toLowerCase().includes(query.toLowerCase()) || 
            user.xUsername?.toLowerCase().includes(query.toLowerCase()) || 
            user.phone?.includes(query)) {
          results.push(user);
        }
      });

      if (results.length === 0) {
        await this.bot.sendMessage(chatId, 'No users found.');
        return;
      }

      let resultText = '🔍 *Search Results*\n\n';
      results.forEach((user, index) => {
        resultText += `${index + 1}. (${user.xUsername || 'No X'}) (@${user.username || 'No TG'}) (${user.balance || 0} MB) /ban_${user.userId}\n`;
      });

      await this.bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Search error:', error);
      await this.bot.sendMessage(chatId, 'Error searching users.');
    }
  }

  async showUsersList(chatId) {
    try {
      const usersSnapshot = await this.db.collection('users').get();

      if (usersSnapshot.empty) {
        await this.bot.sendMessage(chatId, 'No users found.');
        return;
      }

      // Convert to array
      const users = [];
      usersSnapshot.forEach(doc => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Send users in chunks to avoid message too long error
      let userListText = '👥 *Users List*\n\n';
      let count = 0;
      
      for (const user of users) {
        count++;
        const balance = user.balance || 0;
        const xUsername = user.xUsername || 'No X';
        const tgUsername = user.username || 'No TG';
        const userId = user.userId || user.id;
        
        userListText += `${count}. (${xUsername}) (@${tgUsername}) (${balance} MB) /ban_${userId}\n`;

        // Send in chunks of 20 users
        if (count % 20 === 0) {
          await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
          userListText = '';
        }
      }

      // Send remaining users
      if (userListText) {
        await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
      }

      // Add summary
      const totalBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
      const summaryText = `📊 *Summary*\nTotal Users: ${users.length}\nTotal Balance: ${totalBalance.toFixed(2)} MB`;
      await this.bot.sendMessage(chatId, summaryText, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Users list error:', error);
      await this.bot.sendMessage(chatId, 'Error loading users list.');
    }
  }

  
      async startPayout(chatId) {
  try {
    // Get pool and total balance
    const poolDoc = await this.db.collection('settings').doc('pool').get();
    const pool = poolDoc.exists ? poolDoc.data().amount : 0;

    const usersSnapshot = await this.db.collection('users').get();
    let totalBalance = 0;
    usersSnapshot.forEach(doc => {
      totalBalance += doc.data().balance || 0;
    });

    // Check if payout can be started (not when both are zero)
    if (pool === 0 && totalBalance === 0) {
      await this.bot.sendMessage(chatId, '❌ Cannot start payout: Both pool and total balance are zero.');
      return;
    }

    const settingsDoc = await this.db.collection('settings').doc('config').get();
    const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;

    const eligibleUsers = [];

    usersSnapshot.forEach(doc => {
      const user = doc.data();
      if ((user.balance || 0) >= minPayout && !user.banned) {
        eligibleUsers.push({
          ...user,
          id: doc.id
        });
      }
    });

    if (eligibleUsers.length === 0) {
      await this.bot.sendMessage(chatId, 'No eligible users found.');
      return;
    }

    // Sort eligible users by balance
    eligibleUsers.sort((a, b) => (b.balance || 0) - (a.balance || 0));

    let payoutText = '💰 *Eligible Users for Payout*\n\n';
    eligibleUsers.forEach((user, index) => {
      const phone = user.phone || 'No phone';
      const network = this.detectNetwork(phone);
      payoutText += `${index + 1}. \`${phone}\` (${network})\n`;
    });

    payoutText += `\n_Total eligible: ${eligibleUsers.length}_\n`;
    payoutText += '_Pool: ' + pool + ' MB_\n';
    payoutText += '_Total Balance: ' + totalBalance + ' MB_\n';
    payoutText += '_Click confirm to reset all user balances to 0 to process payout_\n';

    await this.bot.sendMessage(chatId, payoutText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm Payout', callback_data: 'confirm_payout' }],
          [{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]
        ]
      }
    });
  } catch (error) {
    console.error('Start payout error:', error);
    await this.bot.sendMessage(chatId, 'Error starting payout.');
  }
}

// Helper method to detect network from phone number
detectNetwork(phone) {
  if (!phone || phone === 'No phone') return 'Unknown';
  
  // Remove any non-digit characters
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Check for MTN prefixes (example - adjust based on your country)
  const mtnPrefixes = ['0703', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916'];
  const gloPrefixes = ['0705', '0805', '0807', '0811', '0815', '0905'];
  const airtelPrefixes = ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0907'];
  const etisalatPrefixes = ['0809', '0817', '0818', '0908', '0909'];
  
  // Get first 4 digits
  const prefix = cleanPhone.substring(0, 4);
  
  if (mtnPrefixes.includes(prefix)) return 'MTN';
  if (gloPrefixes.includes(prefix)) return 'GLO';
  if (airtelPrefixes.includes(prefix)) return 'AIRTEL';
  if (etisalatPrefixes.includes(prefix)) return '9MOBILE';
  
  return 'Unknown';
}





  async confirmPayout(chatId) {
    try {
      // Reset all user balances to 0
      const usersSnapshot = await this.db.collection('users').get();
      const batch = this.db.batch();

      usersSnapshot.forEach(doc => {
        const userRef = this.db.collection('users').doc(doc.id);
        batch.update(userRef, { balance: 0 });
      });

      await batch.commit();

      // Reset pool
      await this.db.collection('settings').doc('pool').set({
        amount: 0,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await this.bot.sendMessage(chatId, '✅ Payout completed! All balances reset to 0.');
      await this.showAdminDashboard(chatId);
    } catch (error) {
      console.error('Confirm payout error:', error);
      await this.bot.sendMessage(chatId, 'Error processing payout.');
    }
  }

  async handleCallback(data, chatId, messageId) {
    try {
      if (data === 'admin_dashboard') {
        await this.showAdminDashboard(chatId);
      } else if (data === 'users_list') {
        await this.showUsersList(chatId);
      } else if (data === 'start_payout') {
        await this.startPayout(chatId);
      } else if (data === 'confirm_payout') {
        await this.confirmPayout(chatId);
      } else if (data === 'admin_task') {
        // Send the /task command
        await this.bot.sendMessage(chatId, '/task');
      } else if (data === 'payout_disabled') {
        await this.bot.answerCallbackQuery(chatId, {
          text: 'Payout disabled: Both pool and total balance are zero',
          show_alert: true
        });
        return;
      } else if (data.startsWith('ban_')) {
        const userId = data.replace('ban_', '');
        await this.banUser(userId, chatId);
      }

      // Delete the callback message
      await this.bot.deleteMessage(chatId, messageId).catch(() => {});
    } catch (error) {
      console.error('Admin callback error:', error);
    }
  }
}

module.exports = AdminHandler;