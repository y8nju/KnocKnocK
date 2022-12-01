const mongoose = require('mongoose');
const accountSchema = new mongoose.Schema({
	id: String, 
    password: String,
    email: String
})
module.exports = mongoose.model('chatAccount', accountSchema)