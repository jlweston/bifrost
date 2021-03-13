const submitFormButton = document.querySelector('#mqtt-setup-form');
const responseParagraph = document.getElementById('response')
const volumeSlider = document.getElementById('volume')

submitFormButton.addEventListener('submit', (event) => {
  event.preventDefault();   // stop the form from submitting

  // Clear previous error message
  responseParagraph.innerHTML = '';
  
  let url = document.getElementById('url').value;
  let username = document.getElementById('username').value;
  let password = document.getElementById('password').value;
  let baseTopic = document.getElementById('base-topic').value;

  window.myAPI.send('mqtt-setup', { url, username, password, baseTopic });
  
  let openAtLogin = document.getElementById('open-at-login').checked;
  window.myAPI.send('startup-preferences', { openAtLogin });
});

window.myAPI.receive("mqtt-setup-error", (data) => {
  responseParagraph.innerHTML = data
});

// TODO success handler... hide form, change screen to success
// message or summary of states of subscribed topics?
