import telepot

CHAT_ID = "21663309"
BOT_TOKEN = '7013936598:AAG9HKVZoltQnDfoz0UAUJoziWOrgm-FhA0'
telegramBot = telepot.Bot(BOT_TOKEN)


def send_message(text):
    telegramBot.sendMessage(21663309, text, parse_mode="Markdown")

send_message('ffff')