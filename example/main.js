import './style.css'

document.querySelector('#app').innerHTML += `
  <div class="card">
    <button id="counter" type="button">Count is: 0</button>
  </div>
`

let count = 0
document.querySelector('#counter').addEventListener('click', () => {
  count++
  document.querySelector('#counter').textContent = `Count is: ${count}`
})
