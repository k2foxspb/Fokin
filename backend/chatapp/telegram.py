import telebot
from telebot import types

token = '7013936598:AAG9HKVZoltQnDfoz0UAUJoziWOrgm-FhA0'

bot = telebot.TeleBot('7013936598:AAG9HKVZoltQnDfoz0UAUJoziWOrgm-FhA0')

# from telebot import types
def send_message(message):
    chat_id = 939130884
    bot.send_message(chat_id, message)


# @bot.message_handler(commands=['start'])
# def start_message(message):
#     user_id = message.from_user.id
#     markup = types.InlineKeyboardMarkup()
#     button_yes = types.InlineKeyboardButton(text='Да', callback_data='yes')
#     markup.add(button_yes)
#     message = f'привет {message.from_user.first_name} '
#     bot.send_message(user_id, message, reply_markup=markup)
# bot.infinity_polling()
# @botTimeWeb.message_handler(commands=['start'])
# def startBot(message):
#   first_mess = f"<b>{message.from_user.first_name} {message.from_user.last_name}</b>, привет!\nХочешь расскажу немного о нашей компании?"
#   markup = types.InlineKeyboardMarkup()
#   button_yes = types.InlineKeyboardButton(text = 'Да', callback_data='yes')
#   markup.add(button_yes)
#   botTimeWeb.send_message(message.chat.id, first_mess, parse_mode='html', reply_markup=markup)
#
#
# def response(function_call):
#   if function_call.message:
#      if function_call.data == "yes":
#         second_mess = "Мы облачная платформа для разработчиков и бизнеса. Более детально можешь ознакомиться с нами на нашем сайте!"
#         markup = types.InlineKeyboardMarkup()
#         markup.add(types.InlineKeyboardButton("Перейти на сайт", url="https://timeweb.cloud/"))
#         botTimeWeb.send_message(function_call.message.chat.id, second_mess, reply_markup=markup)
#         botTimeWeb.answer_callback_query(function_call.id)
#
#
