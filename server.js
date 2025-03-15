const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
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

// Define schemas and models
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  department: { type: String, required: true },
  password: { type: String, required: true },
});

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  reason: { type: String, required: true },
  avHall: { type: String, required: true },
  date: { type: Date, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  status: { type: String, default: 'booked', enum: ['booked', 'ongoing', 'completed', 'cancelled'] }
});

// Pre-save hook to hash the password
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'avhallbookingsecret',
  resave: false,
  saveUninitialized: false
}));
app.set('view engine', 'ejs');

// Helper function to check for booking conflicts
async function checkBookingConflict(avHall, date, startTime, endTime, excludeBookingId = null) {
  const dateObj = new Date(date);
  const nextDay = new Date(dateObj);
  nextDay.setDate(dateObj.getDate() + 1);
  
  const query = {
    avHall: avHall,
    date: {
      $gte: dateObj,
      $lt: nextDay
    },
    status: { $ne: 'cancelled' },
    _id: excludeBookingId ? { $ne: excludeBookingId } : { $exists: true }
  };
  
  const existingBookings = await Booking.find(query);
  
  for (const booking of existingBookings) {
    const existingStart = convertTimeToMinutes(booking.startTime);
    const existingEnd = convertTimeToMinutes(booking.endTime);
    const newStart = convertTimeToMinutes(startTime);
    const newEnd = convertTimeToMinutes(endTime);
    
    // Check if times overlap
    if ((newStart >= existingStart && newStart < existingEnd) || 
        (newEnd > existingStart && newEnd <= existingEnd) ||
        (newStart <= existingStart && newEnd >= existingEnd)) {
      return booking;
    }
  }
  
  return null;
}

// Helper function to convert time string (HH:MM) to minutes
function convertTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Format time for display
function formatTime(time24) {
  if (!time24) return '';
  
  const [hours, minutes] = time24.split(':');
  let period = 'AM';
  let hours12 = parseInt(hours);
  
  if (hours12 >= 12) {
    period = 'PM';
    if (hours12 > 12) {
      hours12 -= 12;
    }
  }
  
  if (hours12 === 0) {
    hours12 = 12;
  }
  
  return `${hours12}:${minutes} ${period}`;
}

// Update booking statuses based on current time
async function updateBookingStatuses() {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const currentTimeMinutes = convertTimeToMinutes(currentTime);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  try {
    // Find bookings for today
    const todayBookings = await Booking.find({
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      },
      status: { $in: ['booked', 'ongoing'] }
    });
    
    for (const booking of todayBookings) {
      const startTimeMinutes = convertTimeToMinutes(booking.startTime);
      const endTimeMinutes = convertTimeToMinutes(booking.endTime);
      
      if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
        booking.status = 'ongoing';
      } else if (currentTimeMinutes >= endTimeMinutes) {
        booking.status = 'completed';
      }
      
      await booking.save();
    }
    
    // Find past bookings that should be marked as completed
    const pastBookings = await Booking.find({
      date: { $lt: today },
      status: { $in: ['booked', 'ongoing'] }
    });
    
    for (const booking of pastBookings) {
      booking.status = 'completed';
      await booking.save();
    }
  } catch (error) {
    console.error('Error updating booking statuses:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

// Register route
app.post('/register', async (req, res) => {
  try {
    const { name, email, department, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('index', { error: 'Email already registered' });
    }
    
    // Create new user
    const user = new User({
      name,
      email,
      department,
      password
    });
    
    await user.save();
    res.render('index', { success: 'Registration successful. Please login.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.render('index', { error: 'Registration failed. Please try again.' });
  }
});

// Login route
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('index', { error: 'Invalid email or password' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('index', { error: 'Invalid email or password' });
    }
    
    // Set session
    req.session.userId = user._id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.department = user.department;
    
    // Update booking statuses before redirecting
    await updateBookingStatuses();
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('index', { error: 'Login failed. Please try again.' });
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  
  try {
    // Update booking statuses
    await updateBookingStatuses();
    
    // Get all bookings (excluding cancelled ones)
    const allBookings = await Booking.find({ status: { $ne: 'cancelled' } }).sort({ date: 1, startTime: 1 });
    
    // Get user's bookings (excluding cancelled ones)
    const userBookings = await Booking.find({ 
      userId: req.session.userId,
      status: { $ne: 'cancelled' }
    }).sort({ date: 1, startTime: 1 });
    
    // Get user info
    const user = {
      name: req.session.userName,
      department: req.session.department
    };
    
    // Get query parameters
    const error = req.query.error;
    const success = req.query.success;
    const tab = req.query.tab || 'all-bookings';
    
    res.render('main', {
      user,
      allBookings,
      userBookings,
      avHalls: ['AV Hall 1', 'AV Hall 2', 'AV Hall 3', 'AV Hall 4', 'AV Hall 5', 'AV Hall 6'],
      error,
      success,
      formatTime,
      activeTab: tab
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('index', { error: 'An error occurred. Please login again.' });
  }
});
// Book AV Hall route
app.post('/book', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  
  try {
    const { reason, avHall, date, startTime, endTime } = req.body;
    
    // Basic validation
    if (!reason || !avHall || !date || !startTime || !endTime) {
      return res.redirect('/dashboard?error=All fields are required&tab=book-hall');
    }
    
    // Validate time format
    if (startTime >= endTime) {
      return res.redirect('/dashboard?error=End time must be after start time&tab=book-hall');
    }
    
    // Check for conflicting bookings
    const conflict = await checkBookingConflict(avHall, date, startTime, endTime);
    if (conflict) {
      return res.redirect(`/dashboard?error=Hall already booked for this time by ${conflict.userName}&tab=book-hall`);
    }
    
    // Create new booking
    const booking = new Booking({
      userId: req.session.userId,
      userName: req.session.userName,
      reason,
      avHall,
      date,
      startTime,
      endTime,
      status: 'booked'
    });
    
    await booking.save();
    res.redirect('/dashboard?success=Booking successful&tab=my-bookings');
  } catch (error) {
    console.error('Booking error:', error);
    res.redirect('/dashboard?error=Booking failed. Please try again.&tab=book-hall');
  }
});

// Update booking route
app.post('/update/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  
  try {
    const bookingId = req.params.id;
    const { reason, avHall, date, startTime, endTime } = req.body;
    
    // Basic validation
    if (!reason || !avHall || !date || !startTime || !endTime) {
      return res.redirect('/dashboard?error=All fields are required&tab=my-bookings');
    }
    
    // Validate time format
    if (startTime >= endTime) {
      return res.redirect('/dashboard?error=End time must be after start time&tab=my-bookings');
    }
    
    // Find booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.redirect('/dashboard?error=Booking not found&tab=my-bookings');
    }
    
    // Check if user owns this booking
    if (booking.userId.toString() !== req.session.userId) {
      return res.redirect('/dashboard?error=You can only update your own bookings&tab=my-bookings');
    }
    
    // Check if booking is already completed or cancelled
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      return res.redirect('/dashboard?error=Cannot update completed or cancelled bookings&tab=my-bookings');
    }
    
    // Check for conflicting bookings
    const conflict = await checkBookingConflict(avHall, date, startTime, endTime, bookingId);
    if (conflict) {
      return res.redirect(`/dashboard?error=Hall already booked for this time by ${conflict.userName}&tab=my-bookings`);
    }
    
    // Update booking
    booking.reason = reason;
    booking.avHall = avHall;
    booking.date = date;
    booking.startTime = startTime;
    booking.endTime = endTime;
    
    await booking.save();
    res.redirect('/dashboard?success=Booking updated successfully&tab=my-bookings');
  } catch (error) {
    console.error('Update error:', error);
    res.redirect('/dashboard?error=Update failed. Please try again.&tab=my-bookings');
  }
});

// Cancel booking route
app.post('/cancel/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  
  try {
    const bookingId = req.params.id;
    
    // Find booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.redirect('/dashboard?error=Booking not found&tab=my-bookings');
    }
    
    // Check if user owns this booking
    if (booking.userId.toString() !== req.session.userId) {
      return res.redirect('/dashboard?error=You can only cancel your own bookings&tab=my-bookings');
    }
    
    // Check if booking is already completed
    if (booking.status === 'completed') {
      return res.redirect('/dashboard?error=Cannot cancel completed bookings&tab=my-bookings');
    }
    
    // Delete the booking instead of marking it as cancelled
    await Booking.findByIdAndDelete(bookingId);
    
    res.redirect('/dashboard?success=Booking cancelled successfully&tab=my-bookings');
  } catch (error) {
    console.error('Cancel error:', error);
    res.redirect('/dashboard?error=Cancellation failed. Please try again.&tab=my-bookings');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});


// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});