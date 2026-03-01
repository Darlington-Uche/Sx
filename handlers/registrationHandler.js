const { db } = require('../firebase');

class RegistrationHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
    this.registrationStates = new Map();
  }

  async startRegistration(userId, chatId, username, referrerId = null) {
    await this.bot.sendMessage(
      chatId,
      `WELCOME, @${username}\nEnter your X username with @ (make sure to make no mistake)`
    );
    
    this.registrationStates.set(userId.toString(), {
      step: 'xusername',
      username: username,
      referrerId: referrerId // Store referrer ID if any
    });
  }

  async getRegistrationState(userId) {
    return this.registrationStates.get(userId.toString());
  }

  async handleRegistrationInput(userId, chatId, text, messageId) {
    const state = this.registrationStates.get(userId.toString());
    
    if (!state) return;

    try {
      switch (state.step) {
        case 'xusername':
          if (!text.startsWith('@')) {
            await this.bot.sendMessage(chatId, 'Please enter a valid username starting with @');
            return;
          }
          
          state.xUsername = text;
          state.step = 'phone';
          await this.bot.sendMessage(chatId, 'Enter Phone number For data payouts using +234XXXXXXXXXX');
          break;

        case 'phone':
          if (!text.match(/^\+234\d{10}$/)) {
            await this.bot.sendMessage(chatId, 'Please enter a valid Nigerian phone number starting with +234');
            return;
          }
          
          state.phone = text;
          state.step = 'network';
          await this.bot.sendMessage(chatId, 'Enter Network (MTN, GLO, AIRTEL, 9MOBILE)');
          break;

        case 'network':
          const network = text.toUpperCase();
          if (!['MTN', 'GLO', 'AIRTEL', '9MOBILE'].includes(network)) {
            await this.bot.sendMessage(chatId, 'Please enter a valid network (MTN, GLO, AIRTEL, 9MOBILE)');
            return;
          }
          
          state.network = network;
          state.step = 'complete';
          
          // Send completion message with loading animation
          const loadingMsg = await this.bot.sendMessage(chatId, '⏳ Processing registration...');
          
          // Wait 5 seconds
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Save to Firebase
          await this.db.collection('users').doc(userId.toString()).set({
            userId: userId.toString(),
            username: state.username,
            xUsername: state.xUsername,
            phone: state.phone,
            network: state.network,
            balance: 0,
            registered: true,
            banned: false,
            referredBy: state.referrerId,
            registrationDate: new Date().toISOString(),
            completedTasks: [],
            totalReferrals: 0
          });

          // Process referral bonus if there's a referrer
          if (state.referrerId) {
            await this.processReferralBonus(state.referrerId, userId.toString(), chatId);
          }

          await this.bot.deleteMessage(chatId, loadingMsg.message_id);
          
          // Send group invite
          await this.bot.sendMessage(
            chatId,
            '✅ Registration Complete!\n\nJoin our updates group: https://t.me/DailyComboReview\n\nhttps://t.me/TGNAIJAUPDATE\n\nhttps://t.me/onlyTAPTAP\n\n https://t.me/Gunlimitedchannel\n\n Not joining might result in future Ban',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Join Group 1', url: 'https://t.me/DailyComboReview' }],
                  [{ text: 'Join Group 2', url: 'https://t.me/onlyTAPTAP' }],
                  [{ text: 'Join Group 3', url: 'https://t.me/Gunlimitedchannel' }],
                  [{ text: 'Join Group 4', url: 'https://t.me/TGNAIJAUPDATE' }],
                  [{ text: 'Continue to Dashboard', callback_data: 'refresh' }]
                ]
              }
            }
          );
          
          this.registrationStates.delete(userId.toString());
          break;
      }
    } catch (error) {
      console.error('Registration error:', error);
      await this.bot.sendMessage(chatId, 'An error occurred. Please try /start again.');
      this.registrationStates.delete(userId.toString());
    }
  }

  async processReferralBonus(referrerId, newUserId, newUserChatId) {
    try {
      // Check if pool has enough balance
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const pool = poolDoc.exists ? poolDoc.data().amount : 0;
      const bonusAmount = 50; // 50MB each

      if (pool < (bonusAmount * 2)) {
        console.log('Not enough pool balance for referral bonus');
        return;
      }

      // Get referrer info
      const referrerDoc = await this.db.collection('users').doc(referrerId).get();
      if (!referrerDoc.exists) return;

      const referrer = referrerDoc.data();
      
      // Get new user info
      const newUserDoc = await this.db.collection('users').doc(newUserId).get();
      const newUser = newUserDoc.data();

      // Start batch operation
      const batch = this.db.batch();

      // Update referrer balance and referral count
      const referrerRef = this.db.collection('users').doc(referrerId);
      batch.update(referrerRef, {
        balance: (referrer.balance || 0) + bonusAmount,
        totalReferrals: (referrer.totalReferrals || 0) + 1
      });

      // Update new user balance
      const newUserRef = this.db.collection('users').doc(newUserId);
      batch.update(newUserRef, {
        balance: (newUser.balance || 0) + bonusAmount
      });

      // Update pool
      const poolRef = this.db.collection('settings').doc('pool');
      batch.update(poolRef, {
        amount: pool - (bonusAmount * 2)
      });

      await batch.commit();

      // Send notification to referrer
      try {
        await this.bot.sendMessage(
          referrerId,
          `🎉 *Referral Bonus Earned!*\n\n` +
          `@${newUser.username} just completed registration using your referral link!\n\n` +
          `You both received ${bonusAmount}MB bonus! 💰\n\n` +
          `Total Referrals: ${(referrer.totalReferrals || 0) + 1}`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.log('Could not notify referrer:', notifyError.message);
      }

      // Send notification to new user
      try {
        await this.bot.sendMessage(
          newUserId,
          `🎉 *Welcome Bonus!*\n\n` +
          `You received ${bonusAmount}MB for joining through a referral link!\n\n` +
          `Your referrer @${referrer.username} also got ${bonusAmount}MB! 🎊`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.log('Could not notify new user:', notifyError.message);
      }

      // Notify admins
      const admins = process.env.ADMIN_IDS.split(',');
      for (const adminId of admins) {
        try {
          await this.bot.sendMessage(
            adminId,
            `🔄 *Referral Bonus Processed*\n\n` +
            `Referrer: @${referrer.username}\n` +
            `New User: @${newUser.username}\n` +
            `Bonus: ${bonusAmount}MB each\n` +
            `Total: ${bonusAmount * 2}MB from pool`,
            { parse_mode: 'Markdown' }
          );
        } catch (adminError) {
          console.log('Could not notify admin:', adminError.message);
        }
      }

    } catch (error) {
      console.error('Referral bonus error:', error);
    }
  }
}

module.exports = RegistrationHandler;