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

      const adminText = `
👋 *Welcome, Admin*

👥 Users count: ${usersCount}
💰 Total Balance: ${totalBalance.toFixed(2)}MB
📦 Today's pool: ${todayPool.toFixed(2)}MB
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

      await this.bot.sendMessage(chatId, adminText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👥 Users', callback_data: 'users_list' },
              { text: '💰 Start Payout', callback_data: 'start_payout' }
            ],
            [
              { text: '📋 Tasks (!)', callback_data: 'admin_task' },
              { text: '🔄 Refresh', callback_data: 'admin_dashboard' }
            ]
          ]
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
      
      await this.bot.sendMessage(chatId, `✅ Pool set to ${amount}MB`);
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
      
      await this.bot.sendMessage(chatId, `✅ Minimum payout set to ${amount}MB`);
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
      results.forEach(user => {
        resultText += `ID: \`${user.userId}\`\n`;
        resultText += `Username: @${user.username}\n`;
        resultText += `X: ${user.xUsername}\n`;
        resultText += `Phone: ${user.phone}\n`;
        resultText += `Balance: ${user.balance || 0}MB\n`;
        resultText += `Banned: ${user.banned ? 'Yes' : 'No'}\n\n`;
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
      
      // Send users in chunks to avoid message too long error
      let userListText = '👥 *Users List*\n\n';
      let count = 0;
      const keyboard = [];
      
      for (const doc of usersSnapshot.docs) {
        const user = doc.data();
        userListText += `ID: \`${user.userId}\`\n`;
        userListText += `@${user.username} - ${user.xUsername}\n`;
        userListText += `${user.phone}\n`;
        userListText += `Balance: ${user.balance || 0}MB\n`;
        userListText += `Banned: ${user.banned ? '✅' : '❌'}\n`;
        userListText += `/ban ${user.userId}\n\n`;
        
        count++;
        
        // Send in chunks of 5 users
        if (count % 5 === 0) {
          await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
          userListText = '👥 *Users List (continued)*\n\n';
        }
      }
      
      // Send remaining users
      if (userListText !== '👥 *Users List (continued)*\n\n') {
        await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
      }
      
      // Add ban buttons
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        keyboard.push([{ text: `Ban @${user.username}`, callback_data: `ban_${user.userId}` }]);
      });
      
      if (keyboard.length > 0) {
        await this.bot.sendMessage(chatId, 'Quick Ban Actions:', {
          reply_markup: {
            inline_keyboard: keyboard.slice(0, 10) // Limit to 10 buttons
          }
        });
      }
      
    } catch (error) {
      console.error('Users list error:', error);
      await this.bot.sendMessage(chatId, 'Error loading users list.');
    }
  }

  async startPayout(chatId) {
    try {
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const pool = poolDoc.exists ? poolDoc.data().amount : 0;
      
      if (pool === 0) {
        await this.bot.sendMessage(chatId, '❌ Pool is empty. Set pool first with /set_pool');
        return;
      }
      
      const settingsDoc = await this.db.collection('settings').doc('config').get();
      const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;
      
      const usersSnapshot = await this.db.collection('users').get();
      const eligibleUsers = [];
      
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if ((user.balance || 0) >= minPayout && !user.banned) {
          eligibleUsers.push(user);
        }
      });
      
      if (eligibleUsers.length === 0) {
        await this.bot.sendMessage(chatId, 'No eligible users found.');
        return;
      }
      
      let payoutText = '💰 *Eligible Users for Payout*\n\n';
      eligibleUsers.forEach(user => {
        payoutText += `ID: \`${user.userId}\`\n`;
        payoutText += `Phone: \`${user.phone}\`\n`;
        payoutText += `X: ${user.xUsername}\n`;
        payoutText += `Balance: ${user.balance}MB\n\n`;
      });
      
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
      } else if (data === 'admin_tasks') {
        // This will be handled by task handler
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