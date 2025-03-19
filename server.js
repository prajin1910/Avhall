const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const moment = require('moment');
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const uri = "mongodb+srv://reksitrajan01:8n4SHiaJfCZRrimg@cluster0.mperr.mongodb.net/climate_monitor?retryWrites=true&w=majority";
mongoose.connect(uri)
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });


// Define schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  department: { type: String, required: true },
  password: { type: String, required: true }
});

const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    reason: { type: String, required: true },
    avHall: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    status: { type: String, default: 'booked' },
    isDeletedByUser: { type: Boolean, default: false }, // New field
    createdAt: { type: Date, default: Date.now }
  });

// Create models
const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'avhallbookingsecret',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');

// Auth middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/');
};

// Helper function to update booking statuses
const updateBookingStatuses = async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Get all active bookings
  const bookings = await Booking.find({
    status: { $in: ['booked', 'ongoing'] }
  });
  
  // Update status for each booking
  for (const booking of bookings) {
    const bookingDate = new Date(booking.date);
    const startDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      parseInt(booking.startTime.split(':')[0]),
      parseInt(booking.startTime.split(':')[1])
    );
    
    const endDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      parseInt(booking.endTime.split(':')[0]),
      parseInt(booking.endTime.split(':')[1])
    );
    
    // Update to 'ongoing'
    if (now >= startDateTime && now < endDateTime && booking.status === 'booked') {
      await Booking.updateOne({ _id: booking._id }, { status: 'ongoing' });
    }
    
    // Update to 'completed'
    if (now >= endDateTime && booking.status !== 'completed') {
      await Booking.updateOne({ _id: booking._id }, { status: 'completed' });
    }
  }
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { message: '' });
});

// Register
app.post('/register', async (req, res) => {
  try {
    const { name, email, department, password } = req.body;
    const existingUser = await User.findOne({ email });
    
    if (existingUser) {
      return res.render('index', { message: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = new User({
      name,
      email,
      department,
      password: hashedPassword
    });
    
    await newUser.save();
    res.render('index', { message: 'Registration successful! Please login.' });
  } catch (error) {
    console.error(error);
    res.render('index', { message: 'Registration failed. Please try again.' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.render('index', { message: 'Invalid email or password' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.render('index', { message: 'Invalid email or password' });
    }
    
    req.session.userId = user._id;
    req.session.userName = user.name;
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.render('index', { message: 'Login failed. Please try again.' });
  }
});

// Dashboard
app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
      await updateBookingStatuses();
      
      const userId = req.session.userId;
      const userName = req.session.userName;
      const filter = req.query.filter || 'all';
      const user = await User.findById(userId);
      const userDepartment = user.department;
      let bookingQuery = {};
      if (filter && filter !== 'all') {
        bookingQuery.status = filter;
      }
      
      // Get all bookings regardless of deletion status
      let allBookings = await Booking.find(bookingQuery).sort({ date: 1, startTime: 1 });
      
      // Get only user's bookings that haven't been deleted
      let myBookings = await Booking.find({ 
        userId, 
        isDeletedByUser: { $ne: true } // Only get non-deleted bookings
      }).sort({ date: 1, startTime: 1 });
      
      // Sort bookings by status priority: ongoing, booked, completed
      const statusPriority = { 'ongoing': 1, 'booked': 2, 'completed': 3 };
      
      allBookings = allBookings.sort((a, b) => {
        // First sort by status priority
        if (statusPriority[a.status] !== statusPriority[b.status]) {
          return statusPriority[a.status] - statusPriority[b.status];
        }
        
        // If same status, sort by date
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateA - dateB;
        }
        
        // If same date, sort by start time
        return convertTimeToMinutes(a.startTime) - convertTimeToMinutes(b.startTime);
      });
      
      myBookings = myBookings.sort((a, b) => {
        // First sort by status priority
        if (statusPriority[a.status] !== statusPriority[b.status]) {
          return statusPriority[a.status] - statusPriority[b.status];
        }
        
        // If same status, sort by date
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateA - dateB;
        }
        
        // If same date, sort by start time
        return convertTimeToMinutes(a.startTime) - convertTimeToMinutes(b.startTime);
      });
      
      const avHalls = ['AV Hall 1', 'AV Hall 2', 'AV Hall 3', 'AV Hall 4', 'AV Hall 5', 'AV Hall 6'];
      
      res.render('main', {
        userName,
        userId,
        userDepartment, // Add this line to pass department to template
        allBookings,
        myBookings,
        avHalls,
        moment,
        filter,
        message: req.query.message || ''
      });
    } catch (error) {
      console.error(error);
      res.redirect('/?message=An error occurred');
    }
});

// Book hall
app.post('/book', isAuthenticated, async (req, res) => {
    try {
      const { reason, avHall, date, startTime, endTime, tab } = req.body;
      const userId = req.session.userId;
      const userName = req.session.userName;
      
      // Check for time conflict
      const bookingDate = new Date(date);
      const bookings = await Booking.find({
        avHall,
        status: { $in: ['booked', 'ongoing'] }
      });
      
      // Check each booking for time conflicts
      for (const existingBooking of bookings) {
        const existingDate = new Date(existingBooking.date);
        
        // Skip if not on same date
        if (existingDate.toDateString() !== bookingDate.toDateString()) {
          continue;
        }
        
        // Check for time overlap
        const newStart = convertTimeToMinutes(startTime);
        const newEnd = convertTimeToMinutes(endTime);
        const existingStart = convertTimeToMinutes(existingBooking.startTime);
        const existingEnd = convertTimeToMinutes(existingBooking.endTime);
        
        if ((newStart < existingEnd && newEnd > existingStart)) {
          return res.redirect(`/dashboard?message=Hall already booked by ${existingBooking.userName} from ${existingBooking.startTime} to ${existingBooking.endTime}&tab=${tab || 'bookHall'}`);
        }
      }
      
      // Create new booking
      const booking = new Booking({
        userId,
        userName,
        reason,
        avHall,
        date,
        startTime,
        endTime,
        status: 'booked'
      });
      
      await booking.save();
      res.redirect(`/dashboard?message=Booking successful&tab=${tab || 'bookHall'}`);
    } catch (error) {
      console.error(error);
      res.redirect('/dashboard?message=Booking failed&tab=bookHall');
    }
  });
  

// Helper function to convert time to minutes for easier comparison
function convertTimeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}


// Update booking
app.post('/update/:id', isAuthenticated, async (req, res) => {
    try {
      const bookingId = req.params.id;
      const userId = req.session.userId;
      const { reason, avHall, date, startTime, endTime, tab } = req.body;
      const booking = await Booking.findOne({ _id: bookingId, userId });
      
      if (!booking) {
        return res.redirect(`/dashboard?message=Booking not found&tab=${tab || 'myBookings'}`);
      }
      
      if (booking.status === 'completed') {
        return res.redirect(`/dashboard?message=Cannot edit completed bookings&tab=${tab || 'myBookings'}`);
      }
      
      // Check for time conflict
      const bookingDate = new Date(date);
      const bookings = await Booking.find({
        _id: { $ne: bookingId },
        avHall,
        status: { $in: ['booked', 'ongoing'] }
      });
      
      // Check each booking for time conflicts
      for (const existingBooking of bookings) {
        const existingDate = new Date(existingBooking.date);
        
        // Skip if not on same date
        if (existingDate.toDateString() !== bookingDate.toDateString()) {
          continue;
        }
        
        // Check for time overlap
        const newStart = convertTimeToMinutes(startTime);
        const newEnd = convertTimeToMinutes(endTime);
        const existingStart = convertTimeToMinutes(existingBooking.startTime);
        const existingEnd = convertTimeToMinutes(existingBooking.endTime);
        
        if ((newStart < existingEnd && newEnd > existingStart)) {
          return res.redirect(`/dashboard?message=Hall already booked by ${existingBooking.userName} from ${existingBooking.startTime} to ${existingBooking.endTime}&tab=${tab || 'myBookings'}`);
        }
      }
      
      // Update booking
      booking.reason = reason;
      booking.avHall = avHall;
      booking.date = date;
      booking.startTime = startTime;
      booking.endTime = endTime;
      
      await booking.save();
      res.redirect(`/dashboard?message=Booking updated successfully&tab=${tab || 'myBookings'}`);
    } catch (error) {
      console.error(error);
      res.redirect('/dashboard?message=Update failed&tab=myBookings');
    }
  });
// Cancel booking
app.get('/cancel/:id', isAuthenticated, async (req, res) => {
    try {
      const bookingId = req.params.id;
      const userId = req.session.userId;
      const tab = req.query.tab || 'myBookings';
      
      const booking = await Booking.findOne({ _id: bookingId, userId });
      
      if (!booking) {
        return res.redirect(`/dashboard?message=Booking not found&tab=${tab}`);
      }
      
      if (booking.status === 'completed') {
        return res.redirect(`/dashboard?message=Cannot cancel completed bookings&tab=${tab}`);
      }
      
      await Booking.deleteOne({ _id: bookingId, userId });
      res.redirect(`/dashboard?message=Booking cancelled successfully&tab=${tab}`);
    } catch (error) {
      console.error(error);
      res.redirect('/dashboard?message=Cancellation failed&tab=myBookings');
    }
  });
  // Delete booking (only for completed)
app.get('/delete/:id', isAuthenticated, async (req, res) => {
    try {
      const bookingId = req.params.id;
      const userId = req.session.userId;
      const tab = req.query.tab || 'myBookings';
      
      const booking = await Booking.findOne({ _id: bookingId, userId });
      
      if (!booking) {
        return res.redirect(`/dashboard?message=Booking not found&tab=${tab}`);
      }
      
      if (booking.status !== 'completed') {
        return res.redirect(`/dashboard?message=Only completed bookings can be deleted&tab=${tab}`);
      }
      
      // Update the flag instead of deleting
      await Booking.updateOne(
        { _id: bookingId, userId }, 
        { isDeletedByUser: true }
      );
      
      res.redirect(`/dashboard?message=Booking removed from your list&tab=${tab}`);
    } catch (error) {
      console.error(error);
      res.redirect(`/dashboard?message=Removal failed&tab=myBookings`);
    }
  });

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});