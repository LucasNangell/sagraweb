// Test script to verify endpoints
console.log("Testing endpoints...");

// Test setores endpoint
fetch('/api/aux/setores')
  .then(res => res.json())
  .then(data => {
    console.log("Setores response:", data);
  })
  .catch(err => {
    console.error("Error fetching setores:", err);
  });

// Test andamentos endpoint
fetch('/api/aux/andamentos')
  .then(res => res.json())
  .then(data => {
    console.log("Andamentos response:", data);
  })
  .catch(err => {
    console.error("Error fetching andamentos:", err);
  });
